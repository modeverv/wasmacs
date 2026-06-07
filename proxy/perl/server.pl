#!/usr/bin/env perl
use strict;
use warnings;

use HTTP::Tiny;
use IO::Socket::INET;
use JSON::PP qw(decode_json encode_json);
use MIME::Base64 qw(decode_base64 encode_base64);

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
  die "invalid URL" unless ($raw // '') =~ m{\A(https?)://([^/]+)(?:/|\z)};
  my ($scheme, $host_port) = ($1, $2);
  die "unsupported URL scheme: $scheme" unless $scheme eq 'http' || $scheme eq 'https';
  my $origin = "$scheme://$host_port";
  die "URL origin is not allowed: $origin" unless allowed_origins()->{$origin};
  return $raw;
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
  return http_response($status, {
    'Access-Control-Allow-Headers' => 'content-type',
    'Access-Control-Allow-Methods' => 'POST, OPTIONS',
    'Access-Control-Allow-Origin' => '*',
    'Access-Control-Allow-Private-Network' => 'true',
    'Cache-Control' => 'no-store',
    'Content-Type' => 'application/json; charset=utf-8',
  }, $json);
}

sub handle_proxy {
  my ($method, $content) = @_;
  if ($method eq 'OPTIONS') {
    return http_response(204, {
      'Access-Control-Allow-Headers' => 'content-type',
      'Access-Control-Allow-Methods' => 'POST, OPTIONS',
      'Access-Control-Allow-Origin' => '*',
      'Access-Control-Allow-Private-Network' => 'true',
      'Cache-Control' => 'no-store',
    }, '');
  }
  if ($method ne 'POST') {
    return http_response(405, {
      'Access-Control-Allow-Headers' => 'content-type',
      'Access-Control-Allow-Methods' => 'POST, OPTIONS',
      'Access-Control-Allow-Origin' => '*',
      'Access-Control-Allow-Private-Network' => 'true',
      'Allow' => 'POST',
    }, 'method not allowed');
  }

  eval {
    my $payload = decode_json($content);
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
      url => $upstream->{url} || $target,
      status => 0 + ($upstream->{status} || 0),
      statusText => $upstream->{reason} || '',
      headers => \@headers,
      bodyBase64 => encode_base64($upstream->{content} // '', ''),
    });
  } || json_response(400, { error => $@ || 'proxy request failed' });
}

sub http_response {
  my ($status, $headers, $body) = @_;
  my %status_text = (
    200 => 'OK',
    204 => 'No Content',
    400 => 'Bad Request',
    405 => 'Method Not Allowed',
  );
  $body //= '';
  my $response = "HTTP/1.1 $status " . ($status_text{$status} || 'OK') . "\015\012";
  $headers->{'Content-Length'} = length($body);
  for my $name (sort keys %{$headers}) {
    $response .= "$name: $headers->{$name}\015\012";
  }
  return $response . "\015\012" . $body;
}

sub read_http_request {
  my ($connection) = @_;
  my $request_line = <$connection>;
  return unless defined $request_line;
  $request_line =~ s/\015?\012\z//;
  my ($method) = split(/\s+/, $request_line, 3);
  my %headers;
  while (defined(my $line = <$connection>)) {
    $line =~ s/\015?\012\z//;
    last if $line eq '';
    if ($line =~ /\A([^:]+):\s*(.*)\z/) {
      $headers{lc($1)} = $2;
    }
  }
  my $length = int($headers{'content-length'} // 0);
  my $content = '';
  read($connection, $content, $length) if $length > 0;
  return ($method || 'GET', $content);
}

my $port = $ENV{PORT} || 8787;
my $daemon = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1',
  LocalPort => $port,
  Listen => 16,
  ReuseAddr => 1,
  Proto => 'tcp',
)
  or die "failed to listen on 127.0.0.1:$port: $!";
print "wasmacs fetch proxy listening at http://127.0.0.1:$port/\n";

while (my $connection = $daemon->accept) {
  while (1) {
    my ($method, $content) = read_http_request($connection);
    last unless defined $method;
    print {$connection} handle_proxy($method, $content);
    last;
  }
  $connection->close;
  undef($connection);
}
