var util = require('util');

'use strict';

module.exports = {
  myLogger: myLogger
}

var debug = {};
debug.DEBUG = 100;
debug.INFO = 200;
debug.WARN = 300;
debug.ERROR = 400;
debug.NO = 1000;

var loggerCache = {};

/**
 * myLogger class
 */

function myLogger(debugLevel,logger) {
  	this.logger = logger;
	this.debugLevel= debugLevel;
	this.log = function(level, msg) {
		if(this.debugLevel == debug.NO) return;
		if(this.debugLevel > debug.DEBUG && level == "debug") return;
		if(this.debugLevel > debug.INFO && level == "info") return;
		if(this.debugLevel > debug.WARN && level == "warn") return;
		if(this.debugLevel > debug.ERROR && level == "error") return;
		
		msg = util.format.apply(util, Array.prototype.slice.call(arguments, 1));
		if(msg) {
				msg="["+level.toUpperCase()+"] "+msg;
		} else {
			msg=level;
		}
		this.logger(msg);
	}
}

myLogger.createMyLogger = function(debugLevel,logger) {
    // create a class-like logger thing that acts as a function as well
    // as an instance of Logger.
	if(!loggerCache[debugLevel]) {
		var ml = new myLogger(debugLevel,logger);	
		var log = ml.log.bind(ml);
		log.log = ml.log;
		loggerCache[debugLevel] = log;
	}
	return loggerCache[debugLevel];
}
