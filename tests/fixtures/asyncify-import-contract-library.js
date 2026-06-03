mergeInto(LibraryManager.library, {
  $asyncify_contract_state__postset: [
    "globalThis.__asyncifyContractEvents = globalThis.__asyncifyContractEvents || [];",
    "globalThis.__asyncifyContractSeq = globalThis.__asyncifyContractSeq || 0;",
    "globalThis.__asyncifyContractPromiseSeq = globalThis.__asyncifyContractPromiseSeq || 0;",
    "globalThis.__asyncifyContractResolvers = globalThis.__asyncifyContractResolvers || {};",
    "globalThis.__asyncifyContractRecord = function (label, details) {",
    "  globalThis.__asyncifyContractEvents.push({",
    "    seq: ++globalThis.__asyncifyContractSeq,",
    "    label: label,",
    "    details: details || {},",
    "  });",
    "};",
    "globalThis.__asyncifyContractResolve = function (kind, value) {",
    "  var resolver = globalThis.__asyncifyContractResolvers[kind];",
    "  globalThis.__asyncifyContractRecord(kind + ':resolver-called', { value: value });",
    "  if (!resolver) return false;",
    "  delete globalThis.__asyncifyContractResolvers[kind];",
    "  resolver(value);",
    "  globalThis.__asyncifyContractRecord(kind + ':resolve-after', { value: value });",
    "  return true;",
    "};",
  ].join("\n"),
  $asyncify_contract_state: {},

  host_wait_manual_promise__deps: ["$asyncify_contract_state"],
  host_wait_manual_promise: function () {
    var kind = "manual";
    var createdPromiseId = ++globalThis.__asyncifyContractPromiseSeq;
    globalThis.__asyncifyContractRecord(kind + ":import-enter", { createdPromiseId: createdPromiseId });
    var promise = new Promise(function (resolve) {
      globalThis.__asyncifyContractResolvers[kind] = resolve;
      globalThis.__asyncifyContractRecord(kind + ":resolver-bound", {
        createdPromiseId: createdPromiseId,
        resolverPromiseId: createdPromiseId,
      });
    });
    var thenPromiseId = ++globalThis.__asyncifyContractPromiseSeq;
    var returned = promise.then(function (value) {
      globalThis.__asyncifyContractRecord(kind + ":promise-then", {
        createdPromiseId: createdPromiseId,
        thenPromiseId: thenPromiseId,
        value: value,
      });
      return value;
    });
    returned.__asyncifyContractPromiseId = thenPromiseId;
    globalThis.__asyncifyContractRecord(kind + ":promise-returned", {
      createdPromiseId: createdPromiseId,
      resolverPromiseId: createdPromiseId,
      thenPromiseId: thenPromiseId,
      returnedPromiseId: thenPromiseId,
    });
    return returned;
  },

  host_wait_async_wrapper__deps: ["$asyncify_contract_state"],
  host_wait_async_wrapper: async function () {
    var kind = "async-wrapper";
    var createdPromiseId = ++globalThis.__asyncifyContractPromiseSeq;
    globalThis.__asyncifyContractRecord(kind + ":import-enter", { createdPromiseId: createdPromiseId });
    var promise = new Promise(function (resolve) {
      globalThis.__asyncifyContractResolvers[kind] = resolve;
      globalThis.__asyncifyContractRecord(kind + ":resolver-bound", {
        createdPromiseId: createdPromiseId,
        resolverPromiseId: createdPromiseId,
      });
    });
    var thenPromiseId = ++globalThis.__asyncifyContractPromiseSeq;
    var returnedExpression = promise.then(function (value) {
      globalThis.__asyncifyContractRecord(kind + ":promise-then", {
        createdPromiseId: createdPromiseId,
        thenPromiseId: thenPromiseId,
        value: value,
      });
      return value;
    });
    returnedExpression.__asyncifyContractPromiseId = thenPromiseId;
    globalThis.__asyncifyContractRecord(kind + ":promise-return-expression", {
      createdPromiseId: createdPromiseId,
      resolverPromiseId: createdPromiseId,
      thenPromiseId: thenPromiseId,
      returnedExpressionPromiseId: thenPromiseId,
      actualReturnedPromiseId: "unobservable-async-function-wrapper",
      asyncFunctionWrapsReturnExpression: true,
    });
    return returnedExpression;
  },

  host_wait_handle_async__deps: ["$asyncify_contract_state"],
  host_wait_handle_async: function () {
    var kind = "handle-async";
    var createdPromiseId = ++globalThis.__asyncifyContractPromiseSeq;
    globalThis.__asyncifyContractRecord(kind + ":import-enter", { createdPromiseId: createdPromiseId });
    return Asyncify.handleAsync(function () {
      var promise = new Promise(function (resolve) {
        globalThis.__asyncifyContractResolvers[kind] = resolve;
        globalThis.__asyncifyContractRecord(kind + ":resolver-bound", {
          createdPromiseId: createdPromiseId,
          resolverPromiseId: createdPromiseId,
        });
      });
      var thenPromiseId = ++globalThis.__asyncifyContractPromiseSeq;
      var returned = promise.then(function (value) {
        globalThis.__asyncifyContractRecord(kind + ":promise-then", {
          createdPromiseId: createdPromiseId,
          thenPromiseId: thenPromiseId,
          value: value,
        });
        return value;
      });
      returned.__asyncifyContractPromiseId = thenPromiseId;
      globalThis.__asyncifyContractRecord(kind + ":handle-async-returned", {
        createdPromiseId: createdPromiseId,
        resolverPromiseId: createdPromiseId,
        thenPromiseId: thenPromiseId,
        returnedPromiseId: thenPromiseId,
        asyncifyHandleAsyncOwnsSuspend: true,
      });
      return returned;
    });
  },
});
