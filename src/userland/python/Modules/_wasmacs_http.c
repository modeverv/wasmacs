/* _wasmacs_http: HTTP(S) requests through the browser host.

   wasmacs has no sockets.  wasmacs_host_http_fetch (the child runtime,
   src/runtime/process/child/wasmacs-child-library.js) hands one request to
   the browser page, whose Chrome companion extension performs it, and
   suspends this process until the response is there.  Git's HTTP helper
   uses the same import.  Lib/_wasmacs_urllib.py builds urllib.request's
   http/https handler on fetch().  */

#define PY_SSIZE_T_CLEAN
#include "Python.h"

#include <stdlib.h>

/* Filled in by the host: six wasm32 words.  The buffers are malloc'ed in
   this process and belong to the caller.  On failure the headers slot holds
   a diagnostic instead.  */
struct host_response {
    int status;
    char *headers;
    int headers_len;
    char *body;
    int body_len;
    char *final_url;
};

extern int wasmacs_host_http_fetch(const char *url, const char *method,
                                   const char *headers, const void *body,
                                   int body_len, struct host_response *out);

static PyObject *
http_fetch(PyObject *module, PyObject *args)
{
    const char *url, *method, *headers;
    Py_buffer body;
    struct host_response r = {0};
    PyObject *result = NULL;

    if (!PyArg_ParseTuple(args, "sssy*:fetch", &url, &method, &headers, &body)) {
        return NULL;
    }
    int failed = wasmacs_host_http_fetch(url, method, headers, body.buf,
                                         (int) body.len, &r);
    PyBuffer_Release(&body);
    if (failed) {
        /* Without a diagnostic a signal may have interrupted the wait: then
           its handler's exception (KeyboardInterrupt for C-c) is raised.  */
        if (r.headers || PyErr_CheckSignals() == 0) {
            PyObject *message = r.headers
                ? PyUnicode_DecodeUTF8(r.headers, r.headers_len, "replace")
                : PyUnicode_FromString("browser HTTP request failed");
            if (message) {
                PyErr_SetObject(PyExc_OSError, message);
                Py_DECREF(message);
            }
        }
    }
    else {
        result = Py_BuildValue("(iy#y#s)", r.status,
                               r.headers ? r.headers : "", (Py_ssize_t) r.headers_len,
                               r.body ? r.body : "", (Py_ssize_t) r.body_len,
                               r.final_url ? r.final_url : url);
    }
    free(r.headers);
    free(r.body);
    free(r.final_url);
    return result;
}

static PyMethodDef http_methods[] = {
    {"fetch", http_fetch, METH_VARARGS,
     "fetch(url, method, headers, body) -> (status, headers, body, final_url)\n\n"
     "Perform one HTTP(S) request through the browser host.  HEADERS and the\n"
     "returned headers are 'Name: value' lines; BODY is bytes.  A request the\n"
     "host could not perform raises OSError with its reason."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef http_module = {
    PyModuleDef_HEAD_INIT,
    .m_name = "_wasmacs_http",
    .m_doc = "HTTP(S) through the wasmacs browser host (the Chrome companion).",
    .m_size = 0,
    .m_methods = http_methods,
};

PyMODINIT_FUNC
PyInit__wasmacs_http(void)
{
    return PyModuleDef_Init(&http_module);
}
