mergeInto(LibraryManager.library, {
  $asyncify_outer_resume_state__postset: [
    "globalThis.__outerResumeEvents = globalThis.__outerResumeEvents || [];",
    "globalThis.__outerResumeSeq = globalThis.__outerResumeSeq || 0;",
    "globalThis.__outerResumeResolvers = globalThis.__outerResumeResolvers || {};",
    "globalThis.__outerResumeRecord = function (label, details) {",
    "  globalThis.__outerResumeEvents.push({",
    "    seq: ++globalThis.__outerResumeSeq,",
    "    label: label,",
    "    details: details || {},",
    "  });",
    "};",
    "globalThis.__outerResumeResolve = function (value) {",
    "  var resolver = globalThis.__outerResumeResolvers['active'];",
    "  globalThis.__outerResumeRecord('resolver-called', { value: value });",
    "  if (!resolver) return false;",
    "  delete globalThis.__outerResumeResolvers['active'];",
    "  resolver(value);",
    "  globalThis.__outerResumeRecord('resolve-after', { value: value });",
    "  return true;",
    "};",
    /* Expose Asyncify internals for diagnostic observation. */
    "globalThis.__outerResumeGetAsyncifyState = function () {",
    "  if (typeof Asyncify === 'undefined') {",
    "    return { available: false };",
    "  }",
    "  return {",
    "    available: true,",
    "    state: Asyncify.state,",
    "    currDataPresent: !!Asyncify.currData,",
    "    asyncPromiseHandlersPresent: !!Asyncify.asyncPromiseHandlers,",
    "    exportCallStackLength: Asyncify.exportCallStack ? Asyncify.exportCallStack.length : -1,",
    "  };",
    "};",
  ].join("\n"),
  $asyncify_outer_resume_state: {},

  host_wait_handle_async__deps: ["$asyncify_outer_resume_state"],
  host_wait_handle_async: function () {
    var createdSeq = ++globalThis.__outerResumeSeq;
    globalThis.__outerResumeRecord("import-enter", { createdSeq: createdSeq });
    return Asyncify.handleAsync(function () {
      globalThis.__outerResumeRecord("handle-async-enter", { createdSeq: createdSeq });
      var promise = new Promise(function (resolve) {
        globalThis.__outerResumeResolvers["active"] = resolve;
        globalThis.__outerResumeRecord("resolver-bound", { createdSeq: createdSeq });
      });
      var returned = promise.then(function (value) {
        globalThis.__outerResumeRecord("promise-then", { createdSeq: createdSeq, value: value });
        return value;
      });
      globalThis.__outerResumeRecord("handle-async-returning", {
        createdSeq: createdSeq,
        asyncifyState: globalThis.__outerResumeGetAsyncifyState(),
      });
      return returned;
    });
  },
});
