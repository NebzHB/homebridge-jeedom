/* This file is part of Jeedom.
 *
 * Jeedom is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Jeedom is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Jeedom. If not, see <http://www.gnu.org/licenses/>.
 */

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
