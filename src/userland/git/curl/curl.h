/* Private source-compatibility surface for Git 2.52.1 remote-curl.c.
 * This is NOT libcurl: only the options used by that pinned source exist.
 * All HTTP, redirects and TLS are owned by wasmacs's browser host.
 */
#ifndef WASMACS_GIT_CURL_H
#define WASMACS_GIT_CURL_H
#include <stddef.h>
#include <stdint.h>
#define LIBCURL_VERSION_NUM 0x074200
#define CURL_ERROR_SIZE 256
#define CURLAUTH_GSSNEGOTIATE 4
#define CURL_IPRESOLVE_WHATEVER 0
#define CURL_IPRESOLVE_V4 1
#define CURL_IPRESOLVE_V6 2
#define CURL_SEEKFUNC_OK 0
#define CURL_SEEKFUNC_FAIL 1
typedef int64_t curl_off_t;
typedef enum { CURLE_OK, CURLE_FAILED_INIT, CURLE_WRITE_ERROR,
 CURLE_HTTP_RETURNED_ERROR, CURLE_FILE_COULDNT_READ_FILE,
 CURLE_FTP_COULDNT_RETR_FILE, CURLE_UNKNOWN_OPTION } CURLcode;
typedef enum { CURLOPT_NOBODY, CURLOPT_POST, CURLOPT_URL, CURLOPT_ENCODING,
 CURLOPT_POSTFIELDS, CURLOPT_POSTFIELDSIZE, CURLOPT_POSTFIELDSIZE_LARGE,
 CURLOPT_HTTPHEADER, CURLOPT_WRITEFUNCTION, CURLOPT_WRITEDATA,
 CURLOPT_READFUNCTION, CURLOPT_INFILE, CURLOPT_SEEKFUNCTION,
 CURLOPT_SEEKDATA, CURLOPT_FAILONERROR } CURLoption;
typedef enum { CURLINFO_RESPONSE_CODE } CURLINFO;
struct curl_slist { char *data; struct curl_slist *next; };
typedef struct wasmacs_git_curl CURL;
CURLcode curl_easy_setopt(CURL *, CURLoption, ...);
CURLcode curl_easy_getinfo(CURL *, CURLINFO, ...);
struct curl_slist *curl_slist_append(struct curl_slist *, const char *);
void curl_slist_free_all(struct curl_slist *);
#endif
