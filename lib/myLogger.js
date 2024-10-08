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
/* jshint esversion: 6,node: true,-W041: false */
'use strict';

const util = require('util');
const fs = require('fs');

const startLog = "homebridge_start";

module.exports = {
  myLogger: myLogger,
};

var debug = {};
debug.DEBUG = 100;
debug.INFO = 200;
debug.WARNING = 300;
debug.ERROR = 400;
debug.NO = 1000;

var loggerCache = {};

/**
 * myLogger class
 */

function myLogger(debugLevel,logger,creationLogPath) {
	this.logger = logger;
	this.debugLevel= debugLevel;
	this.allowedLevel = ['debug','info','warning','error','conf','|debug','|info','|warning','|error'];
	this.creationLogPath = creationLogPath;
	this.creationPassed = false;
	fs.writeFileSync(this.creationLogPath+startLog, '['+(new Date().toISOString())+"] ---Début du log de création---\n");
	this.log = function(level, msg) {
		msg = util.format.apply(util, Array.prototype.slice.call(arguments, 1));

		if(msg) {
			if(this.allowedLevel.indexOf(level.toLowerCase()) !== -1) {
				if(level.charAt(0) === '|') {
					msg="| ["+level.toUpperCase().replace("|","")+"] "+msg;
				} else {
					msg="["+level.toUpperCase()+"] "+msg;
				}
			} else {
				msg=level.toLowerCase()+' '+msg;
			}
		} else {
			msg=level;
		}
		
		if(!this.creationPassed) {
			fs.writeFileSync(creationLogPath+startLog, '['+(new Date().toISOString())+'] '+msg+"\n", {flag: 'a'});
			if(msg && msg.includes("Homebridge est démarré")) {
				fs.writeFileSync(creationLogPath+startLog, '['+(new Date().toISOString())+"] ----Fin du log de création----\n", {flag: 'a'});	
				this.creationPassed = true;
			}
		}
		
		if(this.debugLevel == debug.NO) {msg=null;return;}
		if(this.debugLevel > debug.DEBUG && (level == "debug" || level == "|debug")) {msg=null;return;}
		if(this.debugLevel > debug.INFO && (level == "info" || level == "|info")) {msg=null;return;}
		if(this.debugLevel > debug.WARNING && (level == "warning" || level == "|warning")) {msg=null;return;}
		if(this.debugLevel > debug.ERROR && (level == "error" || level == "|error")) {msg=null;return;}
		
		this.logger(msg);
		msg=null;
	};
	this.changeLevel = (newDebugLevel) => {
		this.debugLevel=newDebugLevel;
	};
}

myLogger.createMyLogger = function(debugLevel,logger,creationLogPath) {
    // create a class-like logger thing that acts as a function as well
    // as an instance of Logger.
	if(!loggerCache[debugLevel]) {
		var ml = new myLogger(debugLevel,logger,creationLogPath);	
		var log = ml.log.bind(ml);
		log.log = ml.log;
		log.changeLevel = ml.changeLevel.bind(ml);
		loggerCache[debugLevel] = log;
	}
	return loggerCache[debugLevel];
};
