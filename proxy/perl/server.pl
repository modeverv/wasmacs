#!/usr/bin/env perl
use strict;
use warnings;

use HTTP::Tiny;
use JSON::PP qw(decode_json encode_json);
use MIME::Base64 qw(decode_base64 encode_base64);
use HTTP::Daemon;
use HTTP::Response;
use URI;

my @DEFAULT_ALLOWED_ORIGINS = (
  'https://elpa.gnu.org',
  'https://melpa.org',
  'https://stable.melpa.org',
);

my %BLOCKED_HEADERS = map { $_ => 1 } qw(
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
);

sub allowed_origins {
  my $raw = $ENV{WASMACS_PROXY_ALLOWED_ORIGINS} // '';
  my @values = length($raw) ? split(/,/, $raw) : @DEFAULT_ALLOWED_ORIGINS;
  my %allowed;
  for my $value (@values) {
    $value =~ s/^\s+|\s+$//g;
    $allowed{$value} = 1 if length($value);
  }
  return \%allowed;
}

sub assert_allowed_url {
  my ($raw) = @_;
  my $uri = URI->new($raw // '');
  die "invalid URL" unless $uri->scheme && $uri->host;
  die "unsupported URL scheme: " . $uri->scheme
    unless $uri->scheme eq 'http' || $uri->scheme eq 'https';
  my $origin = $uri->scheme . '://' . $uri->host_port;
  die "URL origin is not allowed: $origin" unless allowed_origins()->{$origin};
  return $uri;
}

sub normalize_headers {
  my ($headers) = @_;
  my %normalized;
  return \%normalized unless defined $headers;
  if (ref($headers) eq 'ARRAY') {
    for my $pair (@{$headers}) {
      next unless ref($pair) eq 'ARRAY' && @{$pair} >= 2;
      my $name = lc($pair->[0] // '');
      next if !$name || $BLOCKED_HEADERS{$name};
      $normalized{$name} = "$pair->[1]";
    }
  } elsif (ref($headers) eq 'HASH') {
    for my $name (keys %{$headers}) {
      my $lower = lc($name // '');
      next if !$lower || $BLOCKED_HEADERS{$lower};
      $normalized{$lower} = "$headers->{$name}";
    }
  }
  return \%normalized;
}

sub payload_body {
  my ($payload, $method) = @_;
  return undef if $method eq 'GET' || $method eq 'HEAD';
  return decode_base64($payload->{bodyBase64}) if defined $payload->{bodyBase64};
  return "$payload->{body}" if defined $payload->{body};
  return undef;
}

sub json_response {
  my ($status, $payload) = @_;
  my $json = encode_json($payload);
  my $response = HTTP::Response->new($status);
  $response->header('Cache-Control' => 'no-store');
  $response->header('Content-Type' => 'application/json; charset=utf-8');
  $response->content($json);
  return $response;
}

sub handle_proxy {
  my ($request) = @_;
  if ($request->method ne 'POST') {
    my $response = HTTP::Response->new(405);
    $response->header('Allow' => 'POST');
    $response->content('method not allowed');
    return $response;
  }

  eval {
    my $payload = decode_json($request->content);
    my $target = assert_allowed_url($payload->{url});
    my $method = uc($payload->{method} // 'GET');
    my $upstream = HTTP::Tiny->new(max_redirect => 5)->request($method, "$target", {
      headers => normalize_headers($payload->{headers}),
      content => payload_body($payload, $method),
    });
    my @headers;
    for my $name (sort keys %{$upstream->{headers} // {}}) {
      my $value = $upstream->{headers}{$name};
      push @headers, { name => lc($name), value => ref($value) eq 'ARRAY' ? join(', ', @{$value}) : "$value" };
    }
    return json_response(200, {
      url => $upstream->{url} || "$target",
      status => 0 + ($upstream->{status} || 0),
      statusText => $upstream->{reason} || '',
      headers => \@headers,
      bodyBase64 => encode_base64($upstream->{content} // '', ''),
    });
  } || json_response(400, { error => $@ || 'proxy request failed' });
}

my $port = $ENV{PORT} || 8787;
my $daemon = HTTP::Daemon->new(LocalAddr => '127.0.0.1', LocalPort => $port, ReuseAddr => 1)
  or die "failed to listen on 127.0.0.1:$port: $!";
print "wasmacs fetch proxy listening at http://127.0.0.1:$port/\n";

while (my $connection = $daemon->accept) {
  while (my $request = $connection->get_request) {
    $connection->send_response(handle_proxy($request));
  }
  $connection->close;
  undef($connection);
}
