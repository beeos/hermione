'use strict';

var inherit = require('inherit'),
    _ = require('lodash'),
    utils = require('q-promise-utils'),
    MochaRunner = require('./mocha-runner'),
    BrowserPool = require('../browser-pool'),
    RetryManager = require('../retry-manager'),
    BrowserAgent = require('../browser-agent'),
    logger = require('../utils').logger,
    QEmitter = require('qemitter'),
    passthroughEvent = require('qemitter/utils').passthroughEvent,

    RunnerEvents = require('../constants/runner-events');

var MainRunner = inherit(QEmitter, {
    __constructor: function(config) {
        this._config = config;

        this._retryMgr = new RetryManager(this._config);
        passthroughEvent(this._retryMgr, this, [
            RunnerEvents.TEST_FAIL,
            RunnerEvents.ERROR,
            RunnerEvents.RETRY
        ]);

        this._pool = new BrowserPool(this._config);
    },

    run: function(suites, browsers) {
        var _this = this,
            anyTest = _.identity.bind(null, true);

        return this.emitAndWait(RunnerEvents.RUNNER_START)
            .then(function() {
                return _this._runTestSession(suites, browsers, anyTest);
            })
            .finally(function() {
                return _this.emitAndWait(RunnerEvents.RUNNER_END)
                    .catch(logger.warn);
            });
    },

    _runTestSession: function(suites, browsers, filterFn) {
        var _this = this;

        return _(browsers)
            .map(function(browserId) {
                return _this._runInBrowser(browserId, suites, filterFn);
            })
            .thru(utils.waitForResults)
            .value()
            .then(function() {
                return _this._retryMgr.retry(_this._runTestSession.bind(_this));
            });
    },

    _runInBrowser: function(browserId, suites, filterFn) {
        var browserAgent = new BrowserAgent(browserId, this._pool),
            mochaRunner = MochaRunner.create(this._config, browserAgent);

        passthroughEvent(mochaRunner, this, [
            RunnerEvents.SUITE_BEGIN,
            RunnerEvents.SUITE_END,

            RunnerEvents.TEST_BEGIN,
            RunnerEvents.TEST_END,

            RunnerEvents.TEST_PASS,
            RunnerEvents.TEST_PENDING,

            RunnerEvents.INFO,
            RunnerEvents.WARNING
        ]);

        mochaRunner.on(RunnerEvents.TEST_FAIL, this._retryMgr.handleTestFail.bind(this._retryMgr));
        mochaRunner.on(RunnerEvents.ERROR, this._retryMgr.handleError.bind(this._retryMgr));

        return mochaRunner.run(suites, filterFn);
    }
}, {
    create: function(config) {
        return new MainRunner(config);
    }
});

module.exports = MainRunner;
