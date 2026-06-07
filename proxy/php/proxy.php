<?php

const DEFAULT_ALLOWED_ORIGINS = [
    'https://elpa.gnu.org',
    'https://melpa.org',
    'https://stable.melpa.org',
];

const BLOCKED_HEADERS = [
    'connection' => true,
    'content-length' => true,
    'cookie' => true,
    'host' => true,
    'origin' => true,
    'referer' => true,
    'sec-fetch-dest' => true,
    'sec-fetch-mode' => true,
    'sec-fetch-site' => true,
    'transfer-encoding' => true,
];

function allowed_origins(): array
{
    $raw = getenv('WASMACS_PROXY_ALLOWED_ORIGINS');
    if ($raw === false || trim($raw) === '') {
        return DEFAULT_ALLOWED_ORIGINS;
    }
    return array_values(array_filter(array_map('trim', explode(',', $raw))));
}

function write_json(int $status, array $payload): void
{
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES);
    http_response_code($status);
    header('Access-Control-Allow-Headers: content-type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Private-Network: true');
    header('Cache-Control: no-store');
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen($json));
    echo $json;
}

function assert_allowed_url(string $url): string
{
    $parts = parse_url($url);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
        throw new RuntimeException('invalid URL');
    }
    if ($parts['scheme'] !== 'http' && $parts['scheme'] !== 'https') {
        throw new RuntimeException('unsupported URL scheme: ' . $parts['scheme']);
    }
    $port = isset($parts['port']) ? ':' . $parts['port'] : '';
    $origin = $parts['scheme'] . '://' . $parts['host'] . $port;
    if (!in_array($origin, allowed_origins(), true)) {
        throw new RuntimeException('URL origin is not allowed: ' . $origin);
    }
    return $url;
}

function normalize_headers($headers): string
{
    $lines = [];
    if (!is_array($headers)) {
        return '';
    }
    foreach ($headers as $key => $value) {
        if (is_array($value)) {
            $name = strtolower((string)($value[0] ?? ''));
            $header_value = (string)($value[1] ?? '');
        } else {
            $name = strtolower((string)$key);
            $header_value = (string)$value;
        }
        if ($name === '' || isset(BLOCKED_HEADERS[$name])) {
            continue;
        }
        $lines[] = $name . ': ' . $header_value;
    }
    return implode("\n", $lines);
}

function parse_response_headers(array $header_lines): array
{
    $headers = [];
    foreach ($header_lines as $line) {
        $pos = strpos($line, ':');
        if ($pos === false) {
            continue;
        }
        $headers[] = [
            'name' => strtolower(substr($line, 0, $pos)),
            'value' => trim(substr($line, $pos + 1)),
        ];
    }
    return $headers;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    header('Access-Control-Allow-Headers: content-type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Private-Network: true');
    header('Cache-Control: no-store');
    return;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Access-Control-Allow-Headers: content-type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Private-Network: true');
    header('Allow: POST');
    http_response_code(405);
    echo 'method not allowed';
    return;
}

try {
    $payload = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    $url = assert_allowed_url((string)($payload['url'] ?? ''));
    $method = strtoupper((string)($payload['method'] ?? 'GET'));
    $body = null;
    if ($method !== 'GET' && $method !== 'HEAD') {
        if (isset($payload['bodyBase64']) && is_string($payload['bodyBase64'])) {
            $body = base64_decode($payload['bodyBase64'], true);
        } elseif (isset($payload['body'])) {
            $body = (string)$payload['body'];
        }
    }
    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => normalize_headers($payload['headers'] ?? []),
            'content' => $body,
            'ignore_errors' => true,
        ],
    ]);
    $response_body = file_get_contents($url, false, $context);
    if ($response_body === false) {
        throw new RuntimeException('upstream fetch failed');
    }
    $status = 0;
    $status_text = '';
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})(?:\s+(.*))?$/', $line, $matches)) {
            $status = intval($matches[1]);
            $status_text = $matches[2] ?? '';
        }
    }
    write_json(200, [
        'url' => $url,
        'status' => $status,
        'statusText' => $status_text,
        'headers' => parse_response_headers($http_response_header ?? []),
        'bodyBase64' => base64_encode($response_body),
    ]);
} catch (Throwable $error) {
    write_json(400, ['error' => $error->getMessage()]);
}
