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
/*jshint esversion: 6,node: true */
'use strict';

var request = require('request');
const DEV_DEBUG=false;

function JeedomClient(url, apikey, Plateform) {
	this.apikey = apikey;
	this.url = url + '/core/api/jeeApi.php';
	this._cachedModel = {}; // .objects || .eqLogics || .cmds
	this.Plateform = Plateform;
	this.log = this.Plateform.log;
}

JeedomClient.prototype.getModel = function() {
	var that = this;

	return new Promise(function(resolve, reject) {
		var url = that.url;
		var request_id = Math.floor(Math.random() * 1000);
		request.post(url, {
			json : true,
			gzip : true,
			form : {
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"sync_homebridge","params":{"plugin":"mobile","apikey":"' + that.apikey + '"}}'
			}
		}, function(err, response, json) {
			that.log('debug',"DateTime result:",json.result.config.datetime);
			if (!err && response.statusCode == 200) {
				that._cachedModel=json.result;
				that.log('debug',"DateTime cachedModel:",that._cachedModel.config.datetime);
				resolve(that._cachedModel);
			} else {
				reject(err, response);
			}
		});
	});
};

JeedomClient.prototype.getDeviceProperties = function(ID) {
	var that = this;
	for (var e in that._cachedModel.eqLogics) {
		if (that._cachedModel.eqLogics.hasOwnProperty(e)) {
			var eqLogic = that._cachedModel.eqLogics[e];
			if(eqLogic.id == ID)
				return eqLogic;
		}
	}
	return null;
};

JeedomClient.prototype.getDeviceCmd = function(ID) {
	var that = this;
	var clist = [];
	for (var c in that._cachedModel.cmds) {
		if (that._cachedModel.cmds.hasOwnProperty(c)) {
			var cmd = that._cachedModel.cmds[c];
			if(cmd.eqLogic_id == ID)
				clist.push(cmd);
		}
	}
	return clist;
};

JeedomClient.prototype.updateModelInfo = function(ID,value) {
	var that = this;
	var eq;
	for (var c in that._cachedModel.cmds) {
		if (that._cachedModel.cmds.hasOwnProperty(c)) {
			var cmd = that._cachedModel.cmds[c];
			if(cmd.id == ID && cmd.type=='info') {
				eq = that.getDeviceProperties(cmd.eqLogic_id);
				that.log('info','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
				that.log('info','[[Modification Cache Jeedom: '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') de '+cmd.currentValue+' vers '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
				cmd.currentValue=value;
				return cmd;
			} else if (cmd.id == ID) {
				if(DEV_DEBUG) {
					eq = that.getDeviceProperties(cmd.eqLogic_id);
					that.log('debug','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
					that.log('debug','[[Pas une commande INFO ('+cmd.type+') '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
				}
				return null;
			}
		}
	}
	if(DEV_DEBUG) {
		that.log('debug','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
		that.log('debug','Commande pas trouvée dans le cache jeedom (non visible ou pas envoyé à homebridge): '+ID);
	}
	return null;
};

JeedomClient.prototype.ParseGenericType = function(EqLogic, cmds) {
	var result_cmd = {};
	result_cmd = EqLogic;
	result_cmd.services = {};
	for (var i in cmds) {
		if (isset(cmds[i].generic_type)) {
			if (cmds[i].generic_type !== null) {
				switch(cmds[i].generic_type) {
				/***************** LIGHT ***********************/
				case 'LIGHT_STATE' :
					if (result_cmd.services.light == undefined) {
						result_cmd.services.light = [];
					}
					if (result_cmd.services.light[i] == undefined) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].state = cmds[i];
					break;
				case 'LIGHT_ON' :
					if (result_cmd.services.light == undefined) {
						result_cmd.services.light = [];
					}
					if (result_cmd.services.light[i] == undefined) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].on = cmds[i];
					break;
				case 'LIGHT_OFF' :
					if (result_cmd.services.light == undefined) {
						result_cmd.services.light = [];
					}
					if (result_cmd.services.light[i] == undefined) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].off = cmds[i];
					break;
				case 'LIGHT_SLIDER' :
					if (result_cmd.services.light == undefined) {
						result_cmd.services.light = [];
					}
					if (result_cmd.services.light[i] == undefined) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].slider = cmds[i];
					break;
				case 'LIGHT_COLOR' :
					if (result_cmd.services.light == undefined) {
						result_cmd.services.light = [];
					}
					if (result_cmd.services.light[i] == undefined) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].color = cmds[i];
					break;

				/***************** ENERGY ***********************/
				case 'ENERGY_STATE' :
					if (result_cmd.services.energy == undefined) {
						result_cmd.services.energy = [];
					}
					if (result_cmd.services.energy[i] == undefined) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].state = cmds[i];
					break;
				case 'ENERGY_ON' :
					if (result_cmd.services.energy == undefined) {
						result_cmd.services.energy = [];
					}
					if (result_cmd.services.energy[i] == undefined) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].on = cmds[i];
					break;
				case 'ENERGY_OFF' :
					if (result_cmd.services.energy == undefined) {
						result_cmd.services.energy = [];
					}
					if (result_cmd.services.energy[i] == undefined) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].off = cmds[i];
					break;
				case 'ENERGY_SLIDER' :
					if (result_cmd.services.energy == undefined) {
						result_cmd.services.energy = [];
					}
					if (result_cmd.services.energy[i] == undefined) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].slider = cmds[i]; 
					break;
				/***************** BARRIER/GARAGE**************/
				case "BARRIER_STATE" :
				case "GARAGE_STATE" :
					if (result_cmd.services.GarageDoor == undefined) {
						result_cmd.services.GarageDoor = [];
					}
					if (result_cmd.services.GarageDoor[i] == undefined) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].state = cmds[i];
					break;
				case "GB_OPEN" : // should not be used
					if (result_cmd.services.GarageDoor == undefined) {
						result_cmd.services.GarageDoor = [];
					}
					if (result_cmd.services.GarageDoor[i] == undefined) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].on = cmds[i];
					break;
				case "GB_CLOSE" : // should not be used
					if (result_cmd.services.GarageDoor == undefined) {
						result_cmd.services.GarageDoor = [];
					}
					if (result_cmd.services.GarageDoor[i] == undefined) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].off = cmds[i];
					break;
				case "GB_TOGGLE" :
					if (result_cmd.services.GarageDoor == undefined) {
						result_cmd.services.GarageDoor = [];
					}
					if (result_cmd.services.GarageDoor[i] == undefined) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].toggle = cmds[i];
					break;
				/***************** LOCK ***********************/
				case 'LOCK_STATE' :
					if (result_cmd.services.lock == undefined) {
						result_cmd.services.lock = [];
					}
					if (result_cmd.services.lock[i] == undefined) {
						result_cmd.services.lock[i] = {};
					}
					result_cmd.services.lock[i].state = cmds[i];
					break;
				case 'LOCK_OPEN' :
					if (result_cmd.services.lock == undefined) {
						result_cmd.services.lock = [];
					}
					if (result_cmd.services.lock[i] == undefined) {
						result_cmd.services.lock[i] = {};
					}
					result_cmd.services.lock[i].on = cmds[i];
					break;
				case 'LOCK_CLOSE' :
					if (result_cmd.services.lock == undefined) {
						result_cmd.services.lock = [];
					}
					if (result_cmd.services.lock[i] == undefined) {
						result_cmd.services.lock[i] = {};
					}
					result_cmd.services.lock[i].off = cmds[i];
					break;
				/***************** DoorBell*CREATE A NEW TYPE*NOT WORKING IN HOME YET******************/
				case 'DOORBELL_STATE' :
					if (result_cmd.services.DoorBell == undefined) {
						result_cmd.services.DoorBell = [];
					}
					if (result_cmd.services.DoorBell[i] == undefined) {
						result_cmd.services.DoorBell[i] = {};
					}
					result_cmd.services.DoorBell[i].state = cmds[i];
					break;
				/***************** FLAP ***********************/
				case 'FLAP_STATE' :
					if (result_cmd.services.flap == undefined) {
						result_cmd.services.flap = [];
					}
					if (result_cmd.services.flap[i] == undefined) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].state = cmds[i];
					break;
				case 'FLAP_UP' :
					if (result_cmd.services.flap == undefined) {
						result_cmd.services.flap = [];
					}
					if (result_cmd.services.flap[i] == undefined) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].up = cmds[i];
					break;
				case 'FLAP_DOWN' :
					if (result_cmd.services.flap == undefined) {
						result_cmd.services.flap = [];
					}
					if (result_cmd.services.flap[i] == undefined) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].down = cmds[i];
					break;
				case 'FLAP_SLIDER' :
					if (result_cmd.services.flap == undefined) {
						result_cmd.services.flap = [];
					}
					if (result_cmd.services.flap[i] == undefined) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].slider = cmds[i];
					break;
				case 'FLAP_STOP' :
					if (result_cmd.services.flap == undefined) {
						result_cmd.services.flap = [];
					}
					if (result_cmd.services.flap[i] == undefined) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].stop = cmds[i];
					break;
				/*************** THERMOSTAT ***********************/
				case 'THERMOSTAT_STATE' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.state = cmds[i];
					break;
				case 'THERMOSTAT_STATE_NAME' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.state_name = cmds[i];
					break;
				case 'THERMOSTAT_TEMPERATURE' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.temperature = cmds[i];
					break;
				case 'THERMOSTAT_SET_SETPOINT' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.set_setpoint = cmds[i];
					break;
				case 'THERMOSTAT_SETPOINT' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.setpoint = cmds[i];
					break;
				case 'THERMOSTAT_SET_MODE' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.set_mode = cmds[i];
					break;
				case 'THERMOSTAT_MODE' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.mode = cmds[i];
					break;
				case 'THERMOSTAT_LOCK' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.lock = cmds[i];
					break;
				case 'THERMOSTAT_SET_LOCK' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.set_lock = cmds[i];
					break;
				case 'THERMOSTAT_TEMPERATURE_OUTDOOR' :
					if (result_cmd.services.thermostat == undefined) {
						result_cmd.services.thermostat = {};
					}
					result_cmd.services.thermostat.temperature_outdoor = cmds[i];
					break;
				/*************** ALARME ***********************/
				case 'ALARM_STATE' :
					if (result_cmd.services.alarm == undefined) {
						result_cmd.services.alarm = [];
					}
					if (result_cmd.services.alarm[i] == undefined) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].state = cmds[i];
					break;
				case 'ALARM_MODE' :
					if (result_cmd.services.alarm == undefined) {
						result_cmd.services.alarm = [];
					}
					if (result_cmd.services.alarm[i] == undefined) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].mode = cmds[i];
					break;
				case 'ALARM_ENABLE_STATE' :
					if (result_cmd.services.alarm == undefined) {
						result_cmd.services.alarm = [];
					}
					if (result_cmd.services.alarm[i] == undefined) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].enable_state = cmds[i];
					break;
				case 'ALARM_ARMED' :
					if (result_cmd.services.alarm == undefined) {
						result_cmd.services.alarm = [];
					}
					if (result_cmd.services.alarm[i] == undefined) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].armed = cmds[i];
					break;
				case 'ALARM_RELEASED' :
					if (result_cmd.services.alarm == undefined) {
						result_cmd.services.alarm = [];
					}
					if (result_cmd.services.alarm[i] == undefined) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].released = cmds[i];
					break;
				case 'ALARM_SET_MODE' :
					if (result_cmd.services.alarm == undefined) {
						result_cmd.services.alarm = [];
					}
					if (result_cmd.services.alarm[i] == undefined) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].set_mode = cmds[i];
					break;
				/***************** GENERIC ***********************/
				case 'OPENING_WINDOW' :
				case 'OPENING' :
					if (result_cmd.services.opening == undefined) {
						result_cmd.services.opening = [];
					}
					if (result_cmd.services.opening[i] == undefined) {
						result_cmd.services.opening[i] = {};
					}
					result_cmd.services.opening[i].opening = cmds[i];
					break;
				case 'BATTERY' :
					if (result_cmd.services.battery == undefined) {
						result_cmd.services.battery = [];
					}
					if (result_cmd.services.battery[i] == undefined) {
						result_cmd.services.battery[i] = {};
					}
					result_cmd.services.battery[i].battery = cmds[i];
					break;
				case 'BATTERY_CHARGING' : // not existing yet
					if (result_cmd.services.battery == undefined) {
						result_cmd.services.battery = [];
					}
					if (result_cmd.services.battery[i] == undefined) {
						result_cmd.services.battery[i] = {};
					}
					result_cmd.services.battery[i].batteryCharging = cmds[i];
					break;
				case 'PRESENCE' :
					if (result_cmd.services.presence == undefined) {
						result_cmd.services.presence = [];
					}
					if (result_cmd.services.presence[i] == undefined) {
						result_cmd.services.presence[i] = {};
					}
					result_cmd.services.presence[i].presence = cmds[i];
					break;
				case 'TEMPERATURE' :
					if (cmds[i].currentValue !== '' || cmds[i].currentValue > '-50') {
						if (result_cmd.services.temperature == undefined) {
							result_cmd.services.temperature = [];
						}
						if (result_cmd.services.temperature[i] == undefined) {
							result_cmd.services.temperature[i] = {};
						}
						result_cmd.services.temperature[i].temperature = cmds[i];
					}
					break;
				case 'BRIGHTNESS' :
					if (result_cmd.services.brightness == undefined) {
						result_cmd.services.brightness = [];
					}
					if (result_cmd.services.brightness[i] == undefined) {
						result_cmd.services.brightness[i] = {};
					}
					result_cmd.services.brightness[i].brightness = cmds[i];
					break;
				case 'SMOKE' :
					if (result_cmd.services.smoke == undefined) {
						result_cmd.services.smoke = [];
					}
					if (result_cmd.services.smoke[i] == undefined) {
						result_cmd.services.smoke[i] = {};
					}
					result_cmd.services.smoke[i].smoke = cmds[i];
					break;
				/*case 'UV' : // via custom
					if (result_cmd.services.uv == undefined) {
						result_cmd.services.uv = [];
					}
					if (result_cmd.services.uv[i] == undefined) {
						result_cmd.services.uv[i] = {};
					}
					result_cmd.services.uv[i].uv = cmds[i];
					break;*/
				case 'HUMIDITY' :
					if (result_cmd.services.humidity == undefined) {
						result_cmd.services.humidity = [];
					}
					if (result_cmd.services.humidity[i] == undefined) {
						result_cmd.services.humidity[i] = {};
					}
					result_cmd.services.humidity[i].humidity = cmds[i];
					break;
				/*case 'SABOTAGE' :
					if (result_cmd.services.sabotage == undefined) {
						result_cmd.services.sabotage = [];
					}
					if (result_cmd.services.sabotage[i] == undefined) {
						result_cmd.services.sabotage[i] = {};
					}
					result_cmd.services.sabotage[i].sabotage = cmds[i];
					break;*/
				case 'FLOOD' :
					if (result_cmd.services.flood == undefined) {
						result_cmd.services.flood = [];
					}
					if (result_cmd.services.flood[i] == undefined) {
						result_cmd.services.flood[i] = {};
					}
					result_cmd.services.flood[i].flood = cmds[i];
					break;
				case 'POWER' : // via custom
					if (result_cmd.services.power == undefined) {
						result_cmd.services.power = [];
					}
					if (result_cmd.services.power[i] == undefined) {
						result_cmd.services.power[i] = {};
					}
					result_cmd.services.power[i].power = cmds[i];
					break;
				case 'CONSUMPTION' : // via custom
					if (result_cmd.services.consumption == undefined) {
						result_cmd.services.consumption = [];
					}
					if (result_cmd.services.consumption[i] == undefined) {
						result_cmd.services.consumption[i] = {};
					}
					result_cmd.services.consumption[i].consumption = cmds[i];
					break;
				}
			}
		}
	}
	return result_cmd;
};

JeedomClient.prototype.executeDeviceAction = function(ID, action, param) {
	var that = this;
	var options = ',"options":{}';
	//console.log('params : ' + param);
	if (param != null && action == 'setRGB') {
		options = ',"options":{"color":"' + param + '"}';
	} else if (param != null) {
		options = ',"options":{"slider":' + param + '}';
	}
	
	return new Promise(function(resolve, reject) {
		var url = that.url;
		var request_id = Math.floor(Math.random() * 1000);
		request.post(url, {
			json : true,
			form : {
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"cmd::execCmd","params":{"apikey":"' + that.apikey + '","id":"' + ID + '"' + options + '}}'
			}
		}, function(err, response, json) {
			if (!err && (response.statusCode == 200 || response.statusCode == 202))
				resolve(json.result);
			else
				reject(err, response);
		});
	});
};

JeedomClient.prototype.refreshStates = function() {
	var that = this;
	return new Promise(function(resolve, reject) {
		var url = that.url;
		var request_id = Math.floor(Math.random() * 1000);
		request.post(url, {
			timeout : 70000,
			json : true,
			form : {
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"event::changes","params":{"apikey":"' + that.apikey + '","longPolling":"30","datetime" : "' + that.Plateform.lastPoll + '"}}'
			}
		}, function(err, response, json) {
			if (!err && response.statusCode == 200) {
				resolve(json.result);
			} else {
				reject(err, response);
			}
		});
	});
};

function isset() {
	var a = arguments, l = a.length, i = 0, undef;

	if (l === 0) {
		throw new Error('Empty isset');
	}

	while (i !== l) {
		if (a[i] === undef || a[i] === null) {
			return false;
		}
		i++;
	}
	return true;
}

module.exports.createClient = function(url, apikey, Plateform) {
	return new JeedomClient(url, apikey, Plateform);
};
