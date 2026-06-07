package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

var defaultAllowedOrigins = []string{
	"https://elpa.gnu.org",
	"https://melpa.org",
	"https://stable.melpa.org",
}

var blockedHeaders = map[string]bool{
	"connection":        true,
	"content-length":    true,
	"cookie":            true,
	"host":              true,
	"origin":            true,
	"referer":           true,
	"sec-fetch-dest":    true,
	"sec-fetch-mode":    true,
	"sec-fetch-site":    true,
	"transfer-encoding": true,
}

type headerPair struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type fetchRequest struct {
	URL        string          `json:"url"`
	Method     string          `json:"method"`
	Headers    json.RawMessage `json:"headers"`
	Body       *string         `json:"body"`
	BodyBase64 *string         `json:"bodyBase64"`
}

type fetchResponse struct {
	URL        string       `json:"url"`
	Status     int          `json:"status"`
	StatusText string       `json:"statusText"`
	Headers    []headerPair `json:"headers"`
	BodyBase64 string       `json:"bodyBase64"`
}

func allowedOrigins() map[string]bool {
	raw := strings.TrimSpace(os.Getenv("WASMACS_PROXY_ALLOWED_ORIGINS"))
	values := defaultAllowedOrigins
	if raw != "" {
		values = strings.Split(raw, ",")
	}
	allowed := map[string]bool{}
	for _, value := range values {
		origin := strings.TrimSpace(value)
		if origin != "" {
			allowed[origin] = true
		}
	}
	return allowed
}

func assertAllowedURL(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("invalid URL")
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("unsupported URL scheme: %s", target.Scheme)
	}
	origin := target.Scheme + "://" + target.Host
	if !allowedOrigins()[origin] {
		return nil, fmt.Errorf("URL origin is not allowed: %s", origin)
	}
	return target, nil
}

func normalizeHeaders(raw json.RawMessage) (http.Header, error) {
	headers := http.Header{}
	if len(raw) == 0 || string(raw) == "null" {
		return headers, nil
	}
	var pairs [][]string
	if err := json.Unmarshal(raw, &pairs); err == nil {
		for _, pair := range pairs {
			if len(pair) < 2 {
				continue
			}
			name := strings.ToLower(pair[0])
			if name != "" && !blockedHeaders[name] {
				headers.Set(name, pair[1])
			}
		}
		return headers, nil
	}
	var object map[string]string
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, err
	}
	for name, value := range object {
		lower := strings.ToLower(name)
		if lower != "" && !blockedHeaders[lower] {
			headers.Set(lower, value)
		}
	}
	return headers, nil
}

func requestBody(payload fetchRequest, method string) (io.Reader, error) {
	if method == "GET" || method == "HEAD" {
		return nil, nil
	}
	if payload.BodyBase64 != nil {
		bytesValue, err := base64.StdEncoding.DecodeString(*payload.BodyBase64)
		if err != nil {
			return nil, err
		}
		return bytes.NewReader(bytesValue), nil
	}
	if payload.Body != nil {
		return strings.NewReader(*payload.Body), nil
	}
	return nil, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func handleProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload fetchRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024*1024)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	target, err := assertAllowedURL(payload.URL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	method := strings.ToUpper(payload.Method)
	if method == "" {
		method = "GET"
	}
	body, err := requestBody(payload, method)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	upstreamRequest, err := http.NewRequest(method, target.String(), body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	headers, err := normalizeHeaders(payload.Headers)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	upstreamRequest.Header = headers

	client := http.Client{Timeout: 30 * time.Second}
	upstream, err := client.Do(upstreamRequest)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	defer upstream.Body.Close()
	bodyBytes, err := io.ReadAll(upstream.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	responseHeaders := []headerPair{}
	for name, values := range upstream.Header {
		for _, value := range values {
			responseHeaders = append(responseHeaders, headerPair{Name: strings.ToLower(name), Value: value})
		}
	}
	writeJSON(w, http.StatusOK, fetchResponse{
		URL:        upstream.Request.URL.String(),
		Status:     upstream.StatusCode,
		StatusText: http.StatusText(upstream.StatusCode),
		Headers:    responseHeaders,
		BodyBase64: base64.StdEncoding.EncodeToString(bodyBytes),
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8787"
	}
	http.HandleFunc("/", handleProxy)
	log.Printf("wasmacs fetch proxy listening at http://127.0.0.1:%s/", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, nil))
}
