/* SPDX-License-Identifier: GPL-2.0-only */
/* Browser HTTP adapter for the unmodified, pinned Git remote-curl.c.
 * Git owns the remote-helper protocol, discovery, negotiation, fetch-pack,
 * send-pack, authentication helpers and pack validation. This file owns only
 * HTTP request/response plumbing. No sockets, SOCKFS, promises or timers.
 */
#define USE_THE_REPOSITORY_VARIABLE
#include "git-compat-util.h"
#include "config.h"
#include "credential.h"
#include "http.h"
#include "repository.h"
#include "strbuf.h"
#include "string-list.h"
#include "urlmatch.h"
#include "walker.h"

/* All fields are 32-bit on wasm32. The host allocates each non-NULL pointer
 * using this process's malloc; C owns and frees it. On transport failure,
 * headers may contain a diagnostic instead of HTTP headers. */
struct host_response {
 int status;
 char *headers;
 int headers_len;
 unsigned char *body;
 int body_len;
 char *final_url;
};
extern int wasmacs_host_http_fetch(const char *, const char *, const char *,
                                  const void *, int, struct host_response *);

#define MAX_HTTP_BODY (25U * 1024U * 1024U)
struct wasmacs_git_curl {
 const char *url;
 int post, nobody;
 const void *postfields;
 size_t postsize;
 struct curl_slist *headers;
 size_t (*write_fn)(char *, size_t, size_t, void *);
 size_t (*read_fn)(void *, size_t, size_t, void *);
 void *write_data, *read_data;
 long status;
};

long git_curl_ipresolve;
int active_requests, http_is_verbose;
ssize_t http_post_buffer = 1024 * 1024;
struct credential http_auth = CREDENTIAL_INIT;
char curl_errorstr[CURL_ERROR_SIZE];
enum http_follow_config http_follow_config = HTTP_FOLLOW_INITIAL;
static struct string_list extra_headers = STRING_LIST_INIT_DUP;
static struct active_request_slot slot;
static CURL handle;
static struct strbuf request_origin = STRBUF_INIT;

struct curl_slist *curl_slist_append(struct curl_slist *head, const char *value)
{
 struct curl_slist **tail = &head;
 while (*tail) tail = &(*tail)->next;
 *tail = xcalloc(1, sizeof(**tail));
 (*tail)->data = xstrdup(value);
 return head;
}

void curl_slist_free_all(struct curl_slist *head)
{
 while (head) {
  struct curl_slist *next = head->next;
  free(head->data); free(head); head = next;
 }
}

CURLcode curl_easy_setopt(CURL *c, CURLoption option, ...)
{
 va_list ap;
 va_start(ap, option);
 switch (option) {
 case CURLOPT_URL: c->url = va_arg(ap, const char *); break;
 case CURLOPT_POST: c->post = va_arg(ap, long) != 0; break;
 case CURLOPT_NOBODY: c->nobody = va_arg(ap, long) != 0; break;
 case CURLOPT_POSTFIELDS: c->postfields = va_arg(ap, const void *); break;
 case CURLOPT_POSTFIELDSIZE: c->postsize = va_arg(ap, long); break;
 case CURLOPT_POSTFIELDSIZE_LARGE: c->postsize = va_arg(ap, curl_off_t); break;
 case CURLOPT_HTTPHEADER: c->headers = va_arg(ap, struct curl_slist *); break;
 case CURLOPT_WRITEFUNCTION:
  c->write_fn = va_arg(ap, size_t (*)(char *, size_t, size_t, void *)); break;
 case CURLOPT_WRITEDATA: c->write_data = va_arg(ap, void *); break;
 case CURLOPT_READFUNCTION:
  c->read_fn = va_arg(ap, size_t (*)(void *, size_t, size_t, void *)); break;
 case CURLOPT_INFILE: c->read_data = va_arg(ap, void *); break;
 /* Browser fetch owns compression and response status handling. The adapter
  * buffers each upload, so libcurl's seek callback is never needed. */
 case CURLOPT_ENCODING: case CURLOPT_FAILONERROR:
 case CURLOPT_SEEKFUNCTION: case CURLOPT_SEEKDATA: break;
 default: va_end(ap); die("unsupported browser HTTP option %d", option);
 }
 va_end(ap);
 return CURLE_OK;
}

CURLcode curl_easy_getinfo(CURL *c, CURLINFO info, ...)
{
 va_list ap;
 if (info != CURLINFO_RESPONSE_CODE) return CURLE_UNKNOWN_OPTION;
 va_start(ap, info);
 *va_arg(ap, long *) = c->status;
 va_end(ap);
 return CURLE_OK;
}

size_t fwrite_buffer(char *ptr, size_t size, size_t count, void *data)
{
 strbuf_add(data, ptr, size * count);
 return size * count;
}

static int config_http(const char *key, const char *value,
                       const struct config_context *ctx, void *unused)
{
 (void)unused;
 if (!strcmp(key, "http.extraheader")) {
  if (!value) return config_error_nonbool(key);
  if (!*value) string_list_clear(&extra_headers, 0);
  else string_list_append(&extra_headers, value);
 } else if (!strcmp(key, "http.postbuffer")) {
  http_post_buffer = git_config_ssize_t(key, value, ctx->kvi);
  if (http_post_buffer < 65520) http_post_buffer = 65520;
  if (http_post_buffer > MAX_HTTP_BODY)
   die("http.postBuffer exceeds browser HTTP limit");
 } else if (!strcmp(key, "http.pinnedpubkey") ||
            !strcmp(key, "http.sslcert") || !strcmp(key, "http.sslkey") ||
            !strcmp(key, "http.proxy") || !strcmp(key, "http.followredirects")) {
  die("%s is not supported by the browser HTTP transport", key);
 }
 return 0;
}

static void configure_url(const char *url)
{
 struct urlmatch_config config = URLMATCH_CONFIG_INIT;
 if (!starts_with(url, "http://") && !starts_with(url, "https://"))
  die("browser Git transport requires an http or https URL");
 config.section = "http";
 config.collect_fn = config_http;
 if (!url_normalize(url, &config.url)) die("invalid HTTP URL");
 strbuf_reset(&request_origin);
 strbuf_add(&request_origin, config.url.url, config.url.scheme_len + 3);
 strbuf_add(&request_origin, config.url.url + config.url.host_off,
            config.url.path_off - config.url.host_off);
 string_list_clear(&extra_headers, 0);
 repo_config(the_repository, urlmatch_config_entry, &config);
 urlmatch_config_release(&config);
 free(config.url.url);
 credential_from_url(&http_auth, url);
}

void http_init(struct remote *remote, const char *url, int proactive_auth)
{
 (void)remote; (void)proactive_auth;
 configure_url(url);
}

void http_cleanup(void)
{
 string_list_clear(&extra_headers, 0);
 credential_clear(&http_auth);
 strbuf_release(&request_origin);
}

struct curl_slist *http_copy_default_headers(void)
{
 struct curl_slist *head = NULL;
 struct string_list_item *item;
 for_each_string_list_item(item, &extra_headers)
  head = curl_slist_append(head, item->string);
 return head;
}

static void add_base64(struct strbuf *out, const unsigned char *p, size_t len)
{
 static const char alphabet[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 size_t i;
 for (i = 0; i < len; i += 3) {
  unsigned n = (unsigned)p[i] << 16;
  if (i + 1 < len) n |= (unsigned)p[i + 1] << 8;
  if (i + 2 < len) n |= p[i + 2];
  strbuf_addch(out, alphabet[(n >> 18) & 63]);
  strbuf_addch(out, alphabet[(n >> 12) & 63]);
  strbuf_addch(out, i + 1 < len ? alphabet[(n >> 6) & 63] : '=');
  strbuf_addch(out, i + 2 < len ? alphabet[n & 63] : '=');
 }
}

struct curl_slist *http_append_auth_header(const struct credential *c,
                                          struct curl_slist *headers)
{
 struct curl_slist *item;
 struct strbuf value = STRBUF_INIT;
 for (item = headers; item; item = item->next)
  if (!strncasecmp(item->data, "Authorization:", 14)) return headers;
 if (c->authtype && c->credential)
  strbuf_addf(&value, "Authorization: %s %s", c->authtype, c->credential);
 else if (c->username && c->password) {
  struct strbuf userpass = STRBUF_INIT;
  strbuf_addf(&userpass, "%s:%s", c->username, c->password);
  strbuf_addstr(&value, "Authorization: Basic ");
  add_base64(&value, (unsigned char *)userpass.buf, userpass.len);
  strbuf_release(&userpass);
 }
 if (value.len) headers = curl_slist_append(headers, value.buf);
 strbuf_release(&value);
 return headers;
}

const char *http_get_accept_language_header(void) { return NULL; }

struct active_request_slot *get_active_slot(void)
{
 memset(&handle, 0, sizeof(handle));
 memset(&slot, 0, sizeof(slot));
 slot.curl = &handle;
 slot.in_use = 1;
 return &slot;
}

static void response_release(struct host_response *response)
{
 free(response->headers); free(response->body); free(response->final_url);
 memset(response, 0, sizeof(*response));
}

static void response_header(const struct host_response *response,
                            const char *name, struct strbuf *out)
{
 const char *p = response->headers;
 const char *end = p ? p + response->headers_len : NULL;
 size_t n = strlen(name);
 strbuf_reset(out);
 while (p && p < end) {
  const char *next = memchr(p, '\n', end - p);
  const char *line_end = next ? next : end;
  if (line_end > p && line_end[-1] == '\r') line_end--;
  if (line_end - p > n && p[n] == ':' && !strncasecmp(p, name, n)) {
   p += n + 1;
   while (p < line_end && (*p == ' ' || *p == '\t')) p++;
   strbuf_add(out, p, line_end - p);
   return;
  }
  p = next ? next + 1 : end;
 }
}

static int perform(CURL *c, struct host_response *response)
{
 struct strbuf headers = STRBUF_INIT, upload = STRBUF_INIT;
 struct strbuf clean_url = STRBUF_INIT;
 struct curl_slist *item;
 struct url_info parsed;
 const void *body = c->postfields;
 size_t body_len = c->postsize;
 int ret;
 curl_errorstr[0] = 0;
 if (!url_normalize(c->url, &parsed)) die("invalid HTTP URL");
 strbuf_add(&clean_url, parsed.url, parsed.scheme_len + 3);
 strbuf_addstr(&clean_url, parsed.url + parsed.host_off);
 free(parsed.url);
 /* Remote-helper 'get' can name a different origin (packfile URI). Never
  * forward repository credentials or extra headers to that other server. */
 if (!starts_with(clean_url.buf, request_origin.buf) ||
     clean_url.buf[request_origin.len] != '/')
  die("cross-origin Git HTTP downloads are not supported by this transport");
 for (item = c->headers; item; item = item->next) {
  /* fetch computes its own HTTP framing. Empty Expect suppresses curl's
   * 100-continue behavior; it is not a browser request header. */
  if (!strncasecmp(item->data, "Expect:", 7) ||
      !strncasecmp(item->data, "Transfer-Encoding:", 18)) continue;
  if (strchr(item->data, '\n') || strchr(item->data, '\r'))
   die("newline in HTTP request header");
  strbuf_addf(&headers, "%s\n", item->data);
 }
 if (c->post && !body && c->read_fn) {
  char block[65536];
  size_t n;
  while ((n = c->read_fn(block, 1, sizeof(block), c->read_data))) {
   if (n > sizeof(block) || upload.len + n > MAX_HTTP_BODY)
    die("Git upload exceeds browser HTTP limit (25 MiB)");
   strbuf_add(&upload, block, n);
  }
  body = upload.buf; body_len = upload.len;
 }
 if (body_len > MAX_HTTP_BODY) die("Git upload exceeds browser HTTP limit (25 MiB)");
 ret = wasmacs_host_http_fetch(clean_url.buf,
          c->nobody ? "HEAD" : c->post ? "POST" : "GET", headers.buf,
          body, body_len, response);
 /* Removing URL credentials for fetch is not an HTTP redirect. Preserve
  * the upstream URL in that case so the helper does not reset its credential. */
 if (!ret && response->final_url && !strcmp(response->final_url, clean_url.buf)) {
  free(response->final_url);
  response->final_url = xstrdup(c->url);
 }
 strbuf_release(&clean_url); strbuf_release(&headers); strbuf_release(&upload);
 if (ret) {
  xsnprintf(curl_errorstr, sizeof(curl_errorstr), "%.*s",
   response->headers ? response->headers_len : 27,
   response->headers ? response->headers : "browser HTTP request failed");
  return HTTP_ERROR;
 }
 c->status = response->status;
 if (response->status == 401) {
  struct strbuf challenge = STRBUF_INIT;
  response_header(response, "www-authenticate", &challenge);
  strvec_clear(&http_auth.wwwauth_headers);
  if (challenge.len) strvec_push(&http_auth.wwwauth_headers, challenge.buf);
  strbuf_release(&challenge);
  if ((http_auth.username && http_auth.password) ||
      (http_auth.authtype && http_auth.credential)) {
   credential_reject(the_repository, &http_auth);
   return HTTP_NOAUTH;
  }
  return HTTP_REAUTH;
 }
 if (response->status == 404) return HTTP_MISSING_TARGET;
 if (response->status < 200 || response->status >= 300) {
  xsnprintf(curl_errorstr, sizeof(curl_errorstr), "HTTP %d", response->status);
  return HTTP_ERROR;
 }
 credential_approve(the_repository, &http_auth);
 return HTTP_OK;
}

int run_one_slot(struct active_request_slot *s, struct slot_results *results)
{
 struct host_response response = { 0 };
 int ret = perform(s->curl, &response);
 s->http_code = response.status;
 s->curl_result = ret == HTTP_OK ? CURLE_OK : CURLE_HTTP_RETURNED_ERROR;
 if (!response.status) s->curl_result = CURLE_FAILED_INIT;
 if (ret == HTTP_OK && s->curl->write_fn && response.body_len &&
     s->curl->write_fn((char *)response.body, 1, response.body_len,
                       s->curl->write_data) != response.body_len) {
  s->curl_result = CURLE_WRITE_ERROR; ret = HTTP_ERROR;
 }
 if (results) {
  memset(results, 0, sizeof(*results));
  results->http_code = s->http_code;
  results->curl_result = s->curl_result;
 }
 s->in_use = 0;
 response_release(&response);
 return ret;
}

int http_get_strbuf(const char *url, struct strbuf *result,
                     struct http_get_options *options)
{
 struct host_response response = { 0 };
 CURL c = { 0 };
 int ret, retry = 0;
again:
 c.url = url; c.nobody = !result;
 c.headers = http_copy_default_headers();
 c.headers = http_append_auth_header(&http_auth, c.headers);
 if (options && options->extra_headers) {
  struct string_list_item *item;
  for_each_string_list_item(item, options->extra_headers)
   c.headers = curl_slist_append(c.headers, item->string);
 }
 ret = perform(&c, &response);
 curl_slist_free_all(c.headers);
 if (ret == HTTP_REAUTH && !retry++) {
  response_release(&response);
  credential_fill(the_repository, &http_auth, 1);
  goto again;
 }
 if (ret == HTTP_REAUTH) ret = HTTP_NOAUTH;
 if (result && response.body_len) strbuf_add(result, response.body, response.body_len);
 if (options) {
  if (options->content_type) {
   char *separator;
   response_header(&response, "content-type", options->content_type);
   separator = strchr(options->content_type->buf, ';');
   if (separator) strbuf_setlen(options->content_type, separator - options->content_type->buf);
  }
  if (options->charset) strbuf_reset(options->charset);
  if (options->effective_url) {
   strbuf_reset(options->effective_url);
   strbuf_addstr(options->effective_url, response.final_url ? response.final_url : url);
  }
  if (ret == HTTP_OK && options->base_url && response.final_url &&
      strcmp(url, response.final_url)) {
   struct strbuf *base = options->base_url;
   size_t tail_len;
   if (!starts_with(url, base->buf)) die("unexpected HTTP redirect base");
   tail_len = strlen(url) - base->len;
   if (strlen(response.final_url) < tail_len ||
       strcmp(response.final_url + strlen(response.final_url) - tail_len,
              url + base->len))
    die("HTTP redirect does not preserve Git service path");
   strbuf_reset(base);
   strbuf_add(base, response.final_url, strlen(response.final_url) - tail_len);
   configure_url(base->buf);
  }
 }
 response_release(&response);
 return ret;
}

int http_get_file(const char *url, const char *filename, struct http_get_options *options)
{
 struct strbuf data = STRBUF_INIT;
 int ret = http_get_strbuf(url, &data, options);
 if (!ret) {
  int fd = open(filename, O_CREAT | O_WRONLY | O_TRUNC, 0666);
  if (fd < 0) ret = HTTP_ERROR;
  else {
   if (write_in_full(fd, data.buf, data.len) < 0) ret = HTTP_ERROR;
   if (close(fd) < 0) ret = HTTP_ERROR;
  }
 }
 strbuf_release(&data);
 return ret;
}

/* The product transport supports smart HTTP only. Keep this explicit instead
 * of shipping a partial implementation of object walking or WebDAV. */
int http_fetch_ref(const char *base, struct ref *ref)
{
 (void)base; (void)ref;
 die("dumb HTTP repositories are not supported; use a smart HTTP Git server");
}
struct walker *get_http_walker(const char *url)
{
 (void)url;
 die("dumb HTTP repositories are not supported; use a smart HTTP Git server");
}
