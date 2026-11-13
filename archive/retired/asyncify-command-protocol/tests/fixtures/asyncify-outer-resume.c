#include <emscripten.h>

extern int host_wait_handle_async(void);

static int post_wait_phase = 0;

EMSCRIPTEN_KEEPALIVE
int fixture_post_wait_phase(void) {
  return post_wait_phase;
}

/* Called via Module.ccall / Module._fixture_call_handle_async */
EMSCRIPTEN_KEEPALIVE
int fixture_call_handle_async(void) {
  post_wait_phase = 10;
  int value = host_wait_handle_async();
  post_wait_phase = 11;
  return value + 40;
}

int main(void) {
  post_wait_phase = 20;
  int value = host_wait_handle_async();
  post_wait_phase = 21;
  return 0;
}
