#include <emscripten.h>

extern int host_wait_async_wrapper (void);
extern int host_wait_handle_async (void);
extern int host_wait_manual_promise (void);

static int fixture_phase;
static int fixture_last_value;

EMSCRIPTEN_KEEPALIVE
int
fixture_phase_value (void)
{
  return fixture_phase;
}

EMSCRIPTEN_KEEPALIVE
int
fixture_last_wait_value (void)
{
  return fixture_last_value;
}

EMSCRIPTEN_KEEPALIVE
int
fixture_call_async_wrapper (void)
{
  fixture_phase = 100;
  int value = host_wait_async_wrapper ();
  fixture_phase = 101;
  fixture_last_value = value;
  return value + 10;
}

EMSCRIPTEN_KEEPALIVE
int
fixture_call_manual_promise (void)
{
  fixture_phase = 200;
  int value = host_wait_manual_promise ();
  fixture_phase = 201;
  fixture_last_value = value;
  return value + 20;
}

EMSCRIPTEN_KEEPALIVE
int
fixture_call_handle_async (void)
{
  fixture_phase = 300;
  int value = host_wait_handle_async ();
  fixture_phase = 301;
  fixture_last_value = value;
  return value + 40;
}
