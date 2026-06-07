#!/usr/bin/env ruby
# frozen_string_literal: true

require 'base64'
require 'json'
require 'net/http'
require 'uri'
require 'webrick'

DEFAULT_ALLOWED_ORIGINS = [
  'https://elpa.gnu.org',
  'https://melpa.org',
  'https://stable.melpa.org'
].freeze

BLOCKED_HEADERS = %w[
  connection
  content-length
  cookie
  host
  origin
  referer
  sec-fetch-dest
  sec-fetch-mode
  sec-fetch-site
  transfer-encoding
].freeze

def allowed_origins
  raw = ENV.fetch('WASMACS_PROXY_ALLOWED_ORIGINS', '')
  values = raw.strip.empty? ? DEFAULT_ALLOWED_ORIGINS : raw.split(',')
  values.map(&:strip).reject(&:empty?)
end

def assert_allowed_url(raw_url)
  target = URI.parse(raw_url.to_s)
  raise 'invalid URL' unless target.scheme && target.host
  raise "unsupported URL scheme: #{target.scheme}" unless %w[http https].include?(target.scheme)

  origin = "#{target.scheme}://#{target.host}"
  origin += ":#{target.port}" if target.port && target.port != target.default_port
  raise "URL origin is not allowed: #{origin}" unless allowed_origins.include?(origin)

  target
end

def normalize_headers(headers)
  source = case headers
           when Array then headers
           when Hash then headers.to_a
           else []
           end
  source.each_with_object({}) do |pair, normalized|
    name, value = pair
    name = name.to_s.downcase
    next if name.empty? || BLOCKED_HEADERS.include?(name)

    normalized[name] = value.to_s
  end
end

def request_body(payload, method)
  return nil if %w[GET HEAD].include?(method)
  return Base64.decode64(payload['bodyBase64']) if payload['bodyBase64'].is_a?(String)
  return payload['body'].to_s if payload.key?('body')

  nil
end

def json_response(response, status, payload)
  response.status = status
  response['Access-Control-Allow-Headers'] = 'content-type'
  response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
  response['Access-Control-Allow-Origin'] = '*'
  response['Cache-Control'] = 'no-store'
  response['Content-Type'] = 'application/json; charset=utf-8'
  response.body = JSON.generate(payload)
end

def fetch_upstream(payload)
  target = assert_allowed_url(payload['url'])
  method = payload.fetch('method', 'GET').to_s.upcase
  request_class = Net::HTTP.const_get(method.capitalize)
  request = request_class.new(target)
  normalize_headers(payload['headers']).each { |name, value| request[name] = value }
  request.body = request_body(payload, method)

  response = Net::HTTP.start(target.host, target.port, use_ssl: target.scheme == 'https') do |http|
    http.request(request)
  end
  {
    url: target.to_s,
    status: response.code.to_i,
    statusText: response.message.to_s,
    headers: response.each_header.map { |name, value| { name: name.downcase, value: value } },
    bodyBase64: Base64.strict_encode64(response.body || '')
  }
end

port = Integer(ENV.fetch('PORT', '8787'))
server = WEBrick::HTTPServer.new(
  BindAddress: '127.0.0.1',
  Port: port,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

class ProxyServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_OPTIONS(_request, response)
    response.status = 204
    response['Access-Control-Allow-Headers'] = 'content-type'
    response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    response['Access-Control-Allow-Origin'] = '*'
    response['Cache-Control'] = 'no-store'
  end

  def do_GET(_request, response)
    response.status = 405
    response['Access-Control-Allow-Headers'] = 'content-type'
    response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    response['Access-Control-Allow-Origin'] = '*'
    response['Allow'] = 'POST'
    response.body = 'method not allowed'
  end

  def do_POST(request, response)
    json_response(response, 200, fetch_upstream(JSON.parse(request.body)))
  rescue StandardError => e
    json_response(response, 400, { error: e.message })
  end
end

server.mount('/', ProxyServlet)

trap('TERM') { server.shutdown }
trap('INT') { server.shutdown }
puts "wasmacs fetch proxy listening at http://127.0.0.1:#{port}/"
server.start
