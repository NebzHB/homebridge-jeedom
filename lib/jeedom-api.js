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
var DEV_DEBUG;

function JeedomClient(url, apikey, Plateform, myPlugin) {
	this.apikey = apikey;
	this.url = url + '/core/api/jeeApi.php';
	this._cachedModel = {}; // .objects || .eqLogics || .cmds || .scenarios
	this.Plateform = Plateform;
	this.log = this.Plateform.log;
	this.myPlugin = myPlugin || "mobile";
	this.sess_id = "";
	DEV_DEBUG = Plateform.DEV_DEBUG || false;
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
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"sync_homebridge","params":{"plugin":"'+that.myPlugin+'","apikey":"' + that.apikey + '","session":true,"sess_id":"'+ that.sess_id +'"}}'
			}
		}, function(err, response, json) {
			//that.log(JSON.stringify(response).replace('\n',''));
			if (!err && response.statusCode == 200) {
				if(!json) reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(response));
				if(!json.result && json.error)
					reject(json.error);
				else {
					if(json.sess_id !== undefined)
						that.sess_id = json.sess_id;
					else
						that.sess_id = "";
					that._cachedModel=json.result;
					resolve(that._cachedModel);
				}
					
			} else {
				reject(err);
			}
		});
	});
};

JeedomClient.prototype.getDevicePropertiesFromCache = function(ID) {
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

JeedomClient.prototype.getDeviceProperties = function(ID) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
		var url = that.url;
		var request_id = Math.floor(Math.random() * 1000);
		request.post(url, {
			json : true,
			form : {
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"getEql","params":{"plugin":"'+that.myPlugin+'","apikey":"' + that.apikey + '","id":"' + ID + '","session":true,"sess_id":"'+ that.sess_id +'"}}'
			}
		}, function(err, response, json) {
			if (!err && response.statusCode == 200) {
				if(!json.result && json.error)
					reject(json.error);
				else {
					if(json.sess_id !== undefined)
						that.sess_id = json.sess_id;
					else
						that.sess_id = "";
					resolve(json.result);
				}
			} else {
				reject(err);
			}
		});
	});
	return p;
};

JeedomClient.prototype.getDeviceCmdFromCache = function(ID) {
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

JeedomClient.prototype.getScenarioPropertiesFromCache = function(ID) {
	var that = this;
	for (var s in that._cachedModel.scenarios) {
		if (that._cachedModel.scenarios.hasOwnProperty(s)) {
			var scenario = that._cachedModel.scenarios[s];
			if(scenario.id == ID)
				return scenario;
		}
	}
	return null;
};

JeedomClient.prototype.getScenarioProperties = function(ID) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
		var url = that.url;
		var request_id = Math.floor(Math.random() * 1000);
		request.post(url, {
			json : true,
			form : {
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"scenario::byId","params":{"apikey":"' + that.apikey + '","id":"' + ID + '","session":true,"sess_id":"'+ that.sess_id +'"}}'
			}
		}, function(err, response, json) {
			if (!err && response.statusCode == 200) {
				if(!json.result && json.error)
					reject(json.error);
				else {
					if(json.sess_id !== undefined)
						that.sess_id = json.sess_id;
					else
						that.sess_id = "";
					resolve(json.result);
				}
			} else {
				reject(err);
			}
		});
	});
	return p;
};

JeedomClient.prototype.updateModelScenario = function(ID,state) {
	var that = this;
	for (var s in that._cachedModel.scenarios) {
		if (that._cachedModel.scenarios.hasOwnProperty(s)) {
			var scenario_cached = that._cachedModel.scenarios[s];
			if(scenario_cached.id == ID) {
				that.log('debug','[[Modification Cache Jeedom scenarios: '+scenario_cached.name+'> State de '+scenario_cached.state+' vers '+state+' dans ' + JSON.stringify(scenario_cached).replace('\n',''));
				that._cachedModel.scenarios[s].state=state;
				return that._cachedModel.scenarios[s];
			} 
		}
	}
	that.log('debug','Scénario pas trouvée dans le cache jeedom (Nouveau Scénario, redémarrez le démon Homebridge pour prendre en compte): '+ID);
	return null;
};

JeedomClient.prototype.updateModelEq = function(ID,eqLogic) {
	var that = this;
	for (var e in that._cachedModel.eqLogics) {
		if (that._cachedModel.eqLogics.hasOwnProperty(e)) {
			var eqLogic_cached = that._cachedModel.eqLogics[e];
			if(eqLogic_cached.id == ID) {
				that.log('info','[[Modification Cache Jeedom eqLogic: '+eqLogic_cached.name+'>'+eqLogic.name+' Enable de '+eqLogic_cached.isEnable+' vers '+eqLogic.isEnable+' dans ' + JSON.stringify(eqLogic).replace('\n',''));
				that._cachedModel.eqLogics[e].isEnable=eqLogic.isEnable;
				return eqLogic;
			} 
		}
	}
	if(DEV_DEBUG) {
		that.log('debug','Eqlogic pas trouvée dans le cache jeedom (non visible ou pas envoyé à homebridge): '+ID);
	}
	return null;
};

JeedomClient.prototype.updateModelInfo = function(ID,value) {
	var that = this;
	var eq;
	for (var c in that._cachedModel.cmds) {
		if (that._cachedModel.cmds.hasOwnProperty(c)) {
			var cmd = that._cachedModel.cmds[c];
			if(cmd.id == ID && cmd.type=='info') {
				eq = that.getDevicePropertiesFromCache(cmd.eqLogic_id);
				that.log('info','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
				that.log('info','[[Modification Cache Jeedom: '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') de '+cmd.currentValue+' vers '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
				cmd.currentValue=value;
				return cmd;
			} else if (cmd.id == ID) {
				if(DEV_DEBUG) {
					eq = that.getDevicePropertiesFromCache(cmd.eqLogic_id);
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
			if (cmds[i].generic_type) {
				switch(cmds[i].generic_type) {
				case 'SHOCK' :
				case 'RAIN_CURRENT' :
				case 'RAIN_TOTAL' :
				case 'WIND_SPEED' :
				case 'WIND_DIRECTION' :
				case 'GENERIC_INFO':
					if (!result_cmd.services.generic) {
						result_cmd.services.generic = [];
					}
					if (!result_cmd.services.generic[i]) {
						result_cmd.services.generic[i] = {};
					}
					result_cmd.services.generic[i].state = cmds[i];
					break;
				/***************** MODE ***********************/	
				case 'MODE_STATE' :
					if (!result_cmd.services.mode) {
						result_cmd.services.mode = [];
					}
					if (!result_cmd.services.mode[i]) {
						result_cmd.services.mode[i] = {};
					}
					result_cmd.services.mode[i].state = cmds[i];
					break;
				case 'MODE_SET_STATE' :
					if(cmds[i].logicalId=="returnPreviousMode") {
						if (!result_cmd.services.mode) {
							result_cmd.services.mode = [];
						}
						if (!result_cmd.services.mode[i]) {
							result_cmd.services.mode[i] = {};
						}
						result_cmd.services.mode[i].set_state_previous = cmds[i];
					} else {
						if (!result_cmd.services.mode) {
							result_cmd.services.mode = [];
						}
						if (!result_cmd.services.mode[i]) {
							result_cmd.services.mode[i] = {};
						}
						if (!result_cmd.services.mode[i].set_state) {
							result_cmd.services.mode[i].set_state = [];
						}
						result_cmd.services.mode[i].set_state.push(cmds[i]);
					}
					break;
				/***************** LIGHT ***********************/
				case 'LIGHT_STATE' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].state = cmds[i];
					break;
				case 'LIGHT_STATE_BOOL' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].state_bool = cmds[i];
					break;
				case 'LIGHT_ON' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].on = cmds[i];
					break;
				case 'LIGHT_OFF' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].off = cmds[i];
					break;
				case 'LIGHT_SLIDER' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].slider = cmds[i];
					break;
				case 'LIGHT_COLOR' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].color = cmds[i];
					break;
				case 'LIGHT_COLOR_TEMP' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].color_temp = cmds[i];
					break;
				case 'LIGHT_SET_COLOR' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].setcolor = cmds[i];
					break;
				case 'LIGHT_SET_COLOR_TEMP' :
					if (!result_cmd.services.light) {
						result_cmd.services.light = [];
					}
					if (!result_cmd.services.light[i]) {
						result_cmd.services.light[i] = {};
					}
					result_cmd.services.light[i].setcolor_temp = cmds[i];
					break;
				/***************** WEATHER ***********************/
				case 'WEATHER_TEMPERATURE' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].temperature = cmds[i];
					break;	
				case 'WEATHER_HUMIDITY' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].humidity = cmds[i];
					break;
				case 'WEATHER_PRESSURE' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].pressure = cmds[i];
					break;
				case 'WEATHER_WIND_SPEED' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].wind_speed = cmds[i];
					break;
				case 'WEATHER_WIND_DIRECTION' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].wind_direction = cmds[i];
					break;
				case 'WEATHER_CONDITION' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].condition = cmds[i];
					break;
				case 'WEATHER_UVINDEX' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].UVIndex = cmds[i];
					break;		
				case 'WEATHER_VISIBILITY' :
					if (!result_cmd.services.weather) {
						result_cmd.services.weather = [];
					}
					if (!result_cmd.services.weather[i]) {
						result_cmd.services.weather[i] = {};
					}
					result_cmd.services.weather[i].visibility = cmds[i];
					break;	
				/***************** SIREN ***********************/
				case 'SIREN_STATE' :
					if (!result_cmd.services.siren) {
						result_cmd.services.siren = [];
					}
					if (!result_cmd.services.siren[i]) {
						result_cmd.services.siren[i] = {};
					}
					result_cmd.services.siren[i].state = cmds[i];
					break;
				/*case 'SIREN_ON' :
					if (!result_cmd.services.siren) {
						result_cmd.services.siren = [];
					}
					if (!result_cmd.services.siren[i]) {
						result_cmd.services.siren[i] = {};
					}
					result_cmd.services.siren[i].on = cmds[i];
					break;
				case 'SIREN_OFF' :
					if (!result_cmd.services.siren) {
						result_cmd.services.siren = [];
					}
					if (!result_cmd.services.siren[i]) {
						result_cmd.services.siren[i] = {};
					}
					result_cmd.services.siren[i].off = cmds[i];
					break;	*/				
				/***************** ENERGY ***********************/
				case 'ENERGY_STATE' :
					if (!result_cmd.services.energy) {
						result_cmd.services.energy = [];
					}
					if (!result_cmd.services.energy[i]) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].state = cmds[i];
					break;
				case 'ENERGY_ON' :
					if (!result_cmd.services.energy) {
						result_cmd.services.energy = [];
					}
					if (!result_cmd.services.energy[i]) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].on = cmds[i];
					break;
				case 'ENERGY_OFF' :
					if (!result_cmd.services.energy) {
						result_cmd.services.energy = [];
					}
					if (!result_cmd.services.energy[i]) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].off = cmds[i];
					break;
				case 'ENERGY_INUSE' :
					if (!result_cmd.services.energy) {
						result_cmd.services.energy = [];
					}
					if (!result_cmd.services.energy[i]) {
						result_cmd.services.energy[i] = {};
					}
					result_cmd.services.energy[i].inuse = cmds[i]; 
					break;
				/***************** VALVES ***********************/
				case 'FAUCET_STATE' :
					if (!result_cmd.services.faucet) {
						result_cmd.services.faucet = [];
					}
					if (!result_cmd.services.faucet[i]) {
						result_cmd.services.faucet[i] = {};
					}
					result_cmd.services.faucet[i].state = cmds[i];
					break;
				case 'FAUCET_ON' :
					if (!result_cmd.services.faucet) {
						result_cmd.services.faucet = [];
					}
					if (!result_cmd.services.faucet[i]) {
						result_cmd.services.faucet[i] = {};
					}
					result_cmd.services.faucet[i].on = cmds[i];
					break;
				case 'FAUCET_OFF' :
					if (!result_cmd.services.faucet) {
						result_cmd.services.faucet = [];
					}
					if (!result_cmd.services.faucet[i]) {
						result_cmd.services.faucet[i] = {};
					}
					result_cmd.services.faucet[i].off = cmds[i];
					break;
				case 'IRRIG_STATE' :
					if (!result_cmd.services.irrigation) {
						result_cmd.services.irrigation = [];
					}
					if (!result_cmd.services.irrigation[i]) {
						result_cmd.services.irrigation[i] = {};
					}
					result_cmd.services.irrigation[i].state = cmds[i];
					break;
				case 'IRRIG_ON' :
					if (!result_cmd.services.irrigation) {
						result_cmd.services.irrigation = [];
					}
					if (!result_cmd.services.irrigation[i]) {
						result_cmd.services.irrigation[i] = {};
					}
					result_cmd.services.irrigation[i].on = cmds[i];
					break;
				case 'IRRIG_OFF' :
					if (!result_cmd.services.irrigation) {
						result_cmd.services.irrigation = [];
					}
					if (!result_cmd.services.irrigation[i]) {
						result_cmd.services.irrigation[i] = {};
					}
					result_cmd.services.irrigation[i].off = cmds[i];
					break;
				case 'VALVE_STATE' :
					if (!result_cmd.services.valve) {
						result_cmd.services.valve = [];
					}
					if (!result_cmd.services.valve[i]) {
						result_cmd.services.valve[i] = {};
					}
					result_cmd.services.valve[i].state = cmds[i];
					break;
				case 'VALVE_ON' :
					if (!result_cmd.services.valve) {
						result_cmd.services.valve = [];
					}
					if (!result_cmd.services.valve[i]) {
						result_cmd.services.valve[i] = {};
					}
					result_cmd.services.valve[i].on = cmds[i];
					break;
				case 'VALVE_OFF' :
					if (!result_cmd.services.valve) {
						result_cmd.services.valve = [];
					}
					if (!result_cmd.services.valve[i]) {
						result_cmd.services.valve[i] = {};
					}
					result_cmd.services.valve[i].off = cmds[i];
					break;
				case 'VALVE_SET_DURATION' :
					if (!result_cmd.services.valve) {
						result_cmd.services.valve = [];
					}
					if (!result_cmd.services.valve[i]) {
						result_cmd.services.valve[i] = {};
					}
					result_cmd.services.valve[i].setDuration = cmds[i];
					break;
				case 'VALVE_REMAINING_DURATION' :
					if (!result_cmd.services.valve) {
						result_cmd.services.valve = [];
					}
					if (!result_cmd.services.valve[i]) {
						result_cmd.services.valve[i] = {};
					}
					result_cmd.services.valve[i].remainingDuration = cmds[i];
					break;
				/***************** FAN ***********************/
				case 'FAN_STATE' :
				case 'FAN_SPEED_STATE' :
					if (!result_cmd.services.fan) {
						result_cmd.services.fan = [];
					}
					if (!result_cmd.services.fan[i]) {
						result_cmd.services.fan[i] = {};
					}
					result_cmd.services.fan[i].state = cmds[i];
					break;
				case 'FAN_ON' :
					if (!result_cmd.services.fan) {
						result_cmd.services.fan = [];
					}
					if (!result_cmd.services.fan[i]) {
						result_cmd.services.fan[i] = {};
					}
					result_cmd.services.fan[i].on = cmds[i];
					break;
				case 'FAN_OFF' :
					if (!result_cmd.services.fan) {
						result_cmd.services.fan = [];
					}
					if (!result_cmd.services.fan[i]) {
						result_cmd.services.fan[i] = {};
					}
					result_cmd.services.fan[i].off = cmds[i];
					break;
				case 'FAN_SLIDER' :
				case 'FAN_SPEED' :
					if (!result_cmd.services.fan) {
						result_cmd.services.fan = [];
					}
					if (!result_cmd.services.fan[i]) {
						result_cmd.services.fan[i] = {};
					}
					result_cmd.services.fan[i].slider = cmds[i];
					break;					
				/***************** SWITCH ***********************/
				case 'SWITCH_STATE' :
				case 'CAMERA_RECORD_STATE' :
					if (!result_cmd.services.Switch) {
						result_cmd.services.Switch = [];
					}
					if (!result_cmd.services.Switch[i]) {
						result_cmd.services.Switch[i] = {};
					}
					result_cmd.services.Switch[i].state = cmds[i];
					break;
				case 'SWITCH_ON' :
				case 'CAMERA_RECORD' :
					if (!result_cmd.services.Switch) {
						result_cmd.services.Switch = [];
					}
					if (!result_cmd.services.Switch[i]) {
						result_cmd.services.Switch[i] = {};
					}
					result_cmd.services.Switch[i].on = cmds[i];
					break;
				case 'SWITCH_OFF' :
				case 'CAMERA_STOP' :
					if (!result_cmd.services.Switch) {
						result_cmd.services.Switch = [];
					}
					if (!result_cmd.services.Switch[i]) {
						result_cmd.services.Switch[i] = {};
					}
					result_cmd.services.Switch[i].off = cmds[i];
					break;
				/***************** SWITCH ***********************/
				case 'GENERIC_ACTION' :
					if(cmds[i].subType=="other") {
						if (!result_cmd.services.Push) {
							result_cmd.services.Push = [];
						}
						if (!result_cmd.services.Push[i]) {
							result_cmd.services.Push[i] = {};
						}
						result_cmd.services.Push[i].Push = cmds[i];
					}
					break;
				case 'PUSH_BUTTON' :
				case 'CAMERA_UP' :
				case 'CAMERA_DOWN' :
				case 'CAMERA_LEFT' :
				case 'CAMERA_RIGHT' :
				case 'CAMERA_ZOOM' :
				case 'CAMERA_DEZOOM' :
				case 'CAMERA_PRESET' :
					if (!result_cmd.services.Push) {
						result_cmd.services.Push = [];
					}
					if (!result_cmd.services.Push[i]) {
						result_cmd.services.Push[i] = {};
					}
					result_cmd.services.Push[i].Push = cmds[i];
					break;
				/***************** BARRIER/GARAGE**************/
				case "BARRIER_STATE" :
				case "GARAGE_STATE" :
					if (!result_cmd.services.GarageDoor) {
						result_cmd.services.GarageDoor = [];
					}
					if (!result_cmd.services.GarageDoor[i]) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].state = cmds[i];
					break;
				case "GB_OPEN" : // should not be used
					if (!result_cmd.services.GarageDoor) {
						result_cmd.services.GarageDoor = [];
					}
					if (!result_cmd.services.GarageDoor[i]) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].on = cmds[i];
					break;
				case "GB_CLOSE" : // should not be used
					if (!result_cmd.services.GarageDoor) {
						result_cmd.services.GarageDoor = [];
					}
					if (!result_cmd.services.GarageDoor[i]) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].off = cmds[i];
					break;
				case "GB_TOGGLE" :
					if (!result_cmd.services.GarageDoor) {
						result_cmd.services.GarageDoor = [];
					}
					if (!result_cmd.services.GarageDoor[i]) {
						result_cmd.services.GarageDoor[i] = {};
					}
					result_cmd.services.GarageDoor[i].toggle = cmds[i];
					break;
				/***************** LOCK ***********************/
				case 'LOCK_STATE' :
					if (!result_cmd.services.lock) {
						result_cmd.services.lock = [];
					}
					if (!result_cmd.services.lock[i]) {
						result_cmd.services.lock[i] = {};
					}
					result_cmd.services.lock[i].state = cmds[i];
					break;
				case 'LOCK_OPEN' :
					if (!result_cmd.services.lock) {
						result_cmd.services.lock = [];
					}
					if (!result_cmd.services.lock[i]) {
						result_cmd.services.lock[i] = {};
					}
					result_cmd.services.lock[i].on = cmds[i];
					break;
				case 'LOCK_CLOSE' :
					if (!result_cmd.services.lock) {
						result_cmd.services.lock = [];
					}
					if (!result_cmd.services.lock[i]) {
						result_cmd.services.lock[i] = {};
					}
					result_cmd.services.lock[i].off = cmds[i];
					break;
				/***************** StatelessSwitch ******************/
				case 'SWITCH_STATELESS_ALLINONE' :
					if (!result_cmd.services.StatelessSwitch) {
						result_cmd.services.StatelessSwitch = [];
					}
					if (!result_cmd.services.StatelessSwitch[i]) {
						result_cmd.services.StatelessSwitch[i] = {};
					}
					result_cmd.services.StatelessSwitch[i].eventType = cmds[i];
					break;
				case 'SWITCH_STATELESS_SINGLE' :
					if (!result_cmd.services.StatelessSwitchMono) {
						result_cmd.services.StatelessSwitchMono = [];
					}
					if (!result_cmd.services.StatelessSwitchMono[i]) {
						result_cmd.services.StatelessSwitchMono[i] = {};
					}
					result_cmd.services.StatelessSwitchMono[i].Single = cmds[i];
					break;
				case 'SWITCH_STATELESS_DOUBLE' :
					if (!result_cmd.services.StatelessSwitchMono) {
						result_cmd.services.StatelessSwitchMono = [];
					}
					if (!result_cmd.services.StatelessSwitchMono[i]) {
						result_cmd.services.StatelessSwitchMono[i] = {};
					}
					result_cmd.services.StatelessSwitchMono[i].Double = cmds[i];
					break;
				case 'SWITCH_STATELESS_LONG' :
					if (!result_cmd.services.StatelessSwitchMono) {
						result_cmd.services.StatelessSwitchMono = [];
					}
					if (!result_cmd.services.StatelessSwitchMono[i]) {
						result_cmd.services.StatelessSwitchMono[i] = {};
					}
					result_cmd.services.StatelessSwitchMono[i].Long = cmds[i];
					break;
				/***************** FLAP ***********************/
				case 'FLAP_STATE' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].state = cmds[i];
					break;
				case 'FLAP_STATE_CLOSING' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].stateClosing = cmds[i];
					break;
				case 'FLAP_UP' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].up = cmds[i];
					break;
				case 'FLAP_DOWN' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].down = cmds[i];
					break;
				case 'FLAP_SLIDER' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].slider = cmds[i];
					break;
				case 'FLAP_STOP' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].stop = cmds[i];
					break;
				case 'FLAP_HOR_TILT_STATE' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].HorTiltState = cmds[i];
					break;	
				case 'FLAP_HOR_TILT_SLIDER' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].HorTiltSlider = cmds[i];
					break;	
				case 'FLAP_VER_TILT_STATE' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].VerTiltState = cmds[i];
					break;	
				case 'FLAP_VER_TILT_SLIDER' :
					if (!result_cmd.services.flap) {
						result_cmd.services.flap = [];
					}
					if (!result_cmd.services.flap[i]) {
						result_cmd.services.flap[i] = {};
					}
					result_cmd.services.flap[i].VerTiltSlider = cmds[i];
					break;	
				/***************** WINDOW ***********************/
				case 'WINDOW_STATE' :
					if (!result_cmd.services.windowMoto) {
						result_cmd.services.windowMoto = [];
					}
					if (!result_cmd.services.windowMoto[i]) {
						result_cmd.services.windowMoto[i] = {};
					}
					result_cmd.services.windowMoto[i].state = cmds[i];
					break;
				case 'WINDOW_UP' :
					if (!result_cmd.services.windowMoto) {
						result_cmd.services.windowMoto = [];
					}
					if (!result_cmd.services.windowMoto[i]) {
						result_cmd.services.windowMoto[i] = {};
					}
					result_cmd.services.windowMoto[i].up = cmds[i];
					break;
				case 'WINDOW_DOWN' :
					if (!result_cmd.services.windowMoto) {
						result_cmd.services.windowMoto = [];
					}
					if (!result_cmd.services.windowMoto[i]) {
						result_cmd.services.windowMoto[i] = {};
					}
					result_cmd.services.windowMoto[i].down = cmds[i];
					break;
				case 'WINDOW_SLIDER' :
					if (!result_cmd.services.windowMoto) {
						result_cmd.services.windowMoto = [];
					}
					if (!result_cmd.services.windowMoto[i]) {
						result_cmd.services.windowMoto[i] = {};
					}
					result_cmd.services.windowMoto[i].slider = cmds[i];
					break;
				/*************** THERMOSTAT ***********************/
				case 'THERMOSTAT_STATE' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].state = cmds[i];
					break;
				case 'THERMOSTAT_STATE_NAME' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].state_name = cmds[i];
					break;
				case 'THERMOSTAT_TEMPERATURE' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].temperature = cmds[i];
					break;
				case 'THERMOSTAT_SET_SETPOINT' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].set_setpoint = cmds[i];
					break;
				case 'THERMOSTAT_SETPOINT' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].setpoint = cmds[i];
					break;
				case 'THERMOSTAT_SET_MODE' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].set_mode = cmds[i];
					break;
				case 'THERMOSTAT_MODE' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].mode = cmds[i];
					break;
				case 'THERMOSTAT_LOCK' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].lock = cmds[i];
					break;
				case 'THERMOSTAT_SET_LOCK' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].set_lock = cmds[i];
					break;
				case 'THERMOSTAT_SET_UNLOCK' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].set_unlock = cmds[i];
					break;
				case 'THERMOSTAT_TEMPERATURE_OUTDOOR' :
					if (!result_cmd.services.thermostat) {
						result_cmd.services.thermostat = [];
					}
					if (!result_cmd.services.thermostat[i]) {
						result_cmd.services.thermostat[i] = {};
					}
					result_cmd.services.thermostat[i].temperature_outdoor = cmds[i];
					break;
				/*************** THERMOSTAT_HC ***********************/
				case 'THERMOSTAT_HC_STATE' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].state = cmds[i];
					break;
				case 'THERMOSTAT_HC_STATE_NAME' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].state_name = cmds[i];
					break;
				case 'THERMOSTAT_HC_TEMPERATURE' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].temperature = cmds[i];
					break;
				case 'THERMOSTAT_HC_SET_SETPOINT_H' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].set_setpointH = cmds[i];
					break;
				case 'THERMOSTAT_HC_SET_SETPOINT_C' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].set_setpointC = cmds[i];
					break;
				case 'THERMOSTAT_HC_SETPOINT_H' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].setpointH = cmds[i];
					break;
				case 'THERMOSTAT_HC_SETPOINT_C' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].setpointC = cmds[i];
					break;
				case 'THERMOSTAT_HC_SET_MODE' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].set_mode = cmds[i];
					break;
				case 'THERMOSTAT_HC_MODE' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].mode = cmds[i];
					break;
				case 'THERMOSTAT_HC_LOCK' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].lock = cmds[i];
					break;
				case 'THERMOSTAT_HC_SET_LOCK' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].set_lock = cmds[i];
					break;
				case 'THERMOSTAT_HC_SET_UNLOCK' :
					if (!result_cmd.services.thermostatHC) {
						result_cmd.services.thermostatHC = [];
					}
					if (!result_cmd.services.thermostatHC[i]) {
						result_cmd.services.thermostatHC[i] = {};
					}
					result_cmd.services.thermostatHC[i].set_unlock = cmds[i];
					break;
				/*************** ALARME ***********************/
				case 'ALARM_STATE' :
					if (!result_cmd.services.alarm) {
						result_cmd.services.alarm = [];
					}
					if (!result_cmd.services.alarm[i]) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].state = cmds[i];
					break;
				case 'ALARM_MODE' :
					if (!result_cmd.services.alarm) {
						result_cmd.services.alarm = [];
					}
					if (!result_cmd.services.alarm[i]) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].mode = cmds[i];
					break;
				case 'ALARM_ENABLE_STATE' :
					if (!result_cmd.services.alarm) {
						result_cmd.services.alarm = [];
					}
					if (!result_cmd.services.alarm[i]) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].enable_state = cmds[i];
					break;
				case 'ALARM_ARMED' :
					if (!result_cmd.services.alarm) {
						result_cmd.services.alarm = [];
					}
					if (!result_cmd.services.alarm[i]) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].armed = cmds[i];
					break;
				case 'ALARM_RELEASED' :
					if (!result_cmd.services.alarm) {
						result_cmd.services.alarm = [];
					}
					if (!result_cmd.services.alarm[i]) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].released = cmds[i];
					break;
				case 'ALARM_SET_MODE' :
					if (!result_cmd.services.alarm) {
						result_cmd.services.alarm = [];
					}
					if (!result_cmd.services.alarm[i]) {
						result_cmd.services.alarm[i] = {};
					}
					result_cmd.services.alarm[i].set_mode = cmds[i];
					break;
				/***************** GENERIC ***********************/
				case 'AIRQUALITY_INDEX' :
					if (!result_cmd.services.AirQuality) {
						result_cmd.services.AirQuality = [];
					}
					if (!result_cmd.services.AirQuality[i]) {
						result_cmd.services.AirQuality[i] = {};
					}
					result_cmd.services.AirQuality[i].Index = cmds[i];
					break;
				case 'AIRQUALITY_PM25' :
					if (!result_cmd.services.AirQuality) {
						result_cmd.services.AirQuality = [];
					}
					if (!result_cmd.services.AirQuality[i]) {
						result_cmd.services.AirQuality[i] = {};
					}
					result_cmd.services.AirQuality[i].PM25 = cmds[i];
					break;
				case 'NOISE' :
					if (!result_cmd.services.Noise) {
						result_cmd.services.Noise = [];
					}
					if (!result_cmd.services.Noise[i]) {
						result_cmd.services.Noise[i] = {};
					}
					result_cmd.services.Noise[i].Noise = cmds[i];
					break;
				case 'CO2' :
					if (!result_cmd.services.CO2) {
						result_cmd.services.CO2 = [];
					}
					if (!result_cmd.services.CO2[i]) {
						result_cmd.services.CO2[i] = {};
					}
					result_cmd.services.CO2[i].CO2 = cmds[i];
					break;
				case 'CO' :
					if (!result_cmd.services.CO) {
						result_cmd.services.CO = [];
					}
					if (!result_cmd.services.CO[i]) {
						result_cmd.services.CO[i] = {};
					}
					result_cmd.services.CO[i].CO = cmds[i];
					break;
				case 'OPENING_WINDOW' :
				case 'OPENING' :
					if (!result_cmd.services.opening) {
						result_cmd.services.opening = [];
					}
					if (!result_cmd.services.opening[i]) {
						result_cmd.services.opening[i] = {};
					}
					result_cmd.services.opening[i].opening = cmds[i];
					break;
				case 'BATTERY' :
					if (!result_cmd.services.battery) {
						result_cmd.services.battery = [];
					}
					if (!result_cmd.services.battery[i]) {
						result_cmd.services.battery[i] = {};
					}
					result_cmd.services.battery[i].battery = cmds[i];
					break;
				case 'BATTERY_CHARGING' : // not existing yet
					if (!result_cmd.services.battery) {
						result_cmd.services.battery = [];
					}
					if (!result_cmd.services.battery[i]) {
						result_cmd.services.battery[i] = {};
					}
					result_cmd.services.battery[i].batteryCharging = cmds[i];
					break;
				case 'DEFECT' :
					if (!result_cmd.services.defect) {
						result_cmd.services.defect = [];
					}
					if (!result_cmd.services.defect[i]) {
						result_cmd.services.defect[i] = {};
					}
					result_cmd.services.defect[i].defect = cmds[i];
					break;
				case 'PRESENCE' :
					if (!result_cmd.services.presence) {
						result_cmd.services.presence = [];
					}
					if (!result_cmd.services.presence[i]) {
						result_cmd.services.presence[i] = {};
					}
					result_cmd.services.presence[i].presence = cmds[i];
					break;
				case 'OCCUPANCY' :
					if (!result_cmd.services.occupancy) {
						result_cmd.services.occupancy = [];
					}
					if (!result_cmd.services.occupancy[i]) {
						result_cmd.services.occupancy[i] = {};
					}
					result_cmd.services.occupancy[i].occupancy = cmds[i];
					break;
				case 'TEMPERATURE' :
					if (!result_cmd.services.temperature) {
						result_cmd.services.temperature = [];
					}
					if (!result_cmd.services.temperature[i]) {
						result_cmd.services.temperature[i] = {};
					}
					result_cmd.services.temperature[i].temperature = cmds[i];
					break;
				case 'BRIGHTNESS' :
					if (!result_cmd.services.brightness) {
						result_cmd.services.brightness = [];
					}
					if (!result_cmd.services.brightness[i]) {
						result_cmd.services.brightness[i] = {};
					}
					result_cmd.services.brightness[i].brightness = cmds[i];
					break;
				case 'SMOKE' :
					if (!result_cmd.services.smoke) {
						result_cmd.services.smoke = [];
					}
					if (!result_cmd.services.smoke[i]) {
						result_cmd.services.smoke[i] = {};
					}
					result_cmd.services.smoke[i].smoke = cmds[i];
					break;
				case 'UV' : // via custom
					if (!result_cmd.services.uv) {
						result_cmd.services.uv = [];
					}
					if (!result_cmd.services.uv[i]) {
						result_cmd.services.uv[i] = {};
					}
					result_cmd.services.uv[i].uv = cmds[i];
					break;
				case 'HUMIDITY' :
					if (!result_cmd.services.humidity) {
						result_cmd.services.humidity = [];
					}
					if (!result_cmd.services.humidity[i]) {
						result_cmd.services.humidity[i] = {};
					}
					result_cmd.services.humidity[i].humidity = cmds[i];
					break;
				case 'SABOTAGE' :
					if (!result_cmd.services.sabotage) {
						result_cmd.services.sabotage = [];
					}
					if (!result_cmd.services.sabotage[i]) {
						result_cmd.services.sabotage[i] = {};
					}
					result_cmd.services.sabotage[i].sabotage = cmds[i];
					break;
				case 'FLOOD' :
					if (!result_cmd.services.flood) {
						result_cmd.services.flood = [];
					}
					if (!result_cmd.services.flood[i]) {
						result_cmd.services.flood[i] = {};
					}
					result_cmd.services.flood[i].flood = cmds[i];
					break;
				case 'POWER' : // via custom
					if (!result_cmd.services.power) {
						result_cmd.services.power = [];
					}
					if (!result_cmd.services.power[i]) {
						result_cmd.services.power[i] = {};
					}
					result_cmd.services.power[i].power = cmds[i];
					break;
				case 'CONSUMPTION' : // via custom
					if (!result_cmd.services.consumption) {
						result_cmd.services.consumption = [];
					}
					if (!result_cmd.services.consumption[i]) {
						result_cmd.services.consumption[i] = {};
					}
					result_cmd.services.consumption[i].consumption = cmds[i];
					break;
				case 'ACTIVE' :
					if (!result_cmd.services.status_active) {
						result_cmd.services.status_active = [];
					}
					if (!result_cmd.services.status_active[i]) {
						result_cmd.services.status_active[i] = {};
					}
					result_cmd.services.status_active[i].status_active = cmds[i];
					break;
				case 'SPEAKER_VOLUME' :
				case 'VOLUME' :
					if (!result_cmd.services.speaker) {
						result_cmd.services.speaker = [];
					}
					if (!result_cmd.services.speaker[i]) {
						result_cmd.services.speaker[i] = {};
					}
					result_cmd.services.speaker[i].volume = cmds[i];
					break;
				case 'SPEAKER_SET_VOLUME' :
				case 'SET_VOLUME' :
					if (!result_cmd.services.speaker) {
						result_cmd.services.speaker = [];
					}
					if (!result_cmd.services.speaker[i]) {
						result_cmd.services.speaker[i] = {};
					}
					result_cmd.services.speaker[i].set_volume = cmds[i];
					break;
				case 'SPEAKER_MUTE' :
					if (!result_cmd.services.speaker) {
						result_cmd.services.speaker = [];
					}
					if (!result_cmd.services.speaker[i]) {
						result_cmd.services.speaker[i] = {};
					}
					result_cmd.services.speaker[i].mute = cmds[i];
					break;
				case 'SPEAKER_MUTE_TOGGLE' :
					if (!result_cmd.services.speaker) {
						result_cmd.services.speaker = [];
					}
					if (!result_cmd.services.speaker[i]) {
						result_cmd.services.speaker[i] = {};
					}
					result_cmd.services.speaker[i].mute_toggle = cmds[i];
					break;
				case 'SPEAKER_MUTE_ON' :
					if (!result_cmd.services.speaker) {
						result_cmd.services.speaker = [];
					}
					if (!result_cmd.services.speaker[i]) {
						result_cmd.services.speaker[i] = {};
					}
					result_cmd.services.speaker[i].mute_on = cmds[i];
					break;
				case 'SPEAKER_MUTE_OFF' :
					if (!result_cmd.services.speaker) {
						result_cmd.services.speaker = [];
					}
					if (!result_cmd.services.speaker[i]) {
						result_cmd.services.speaker[i] = {};
					}
					result_cmd.services.speaker[i].mute_off = cmds[i];
					break;
				case 'PRESSURE' :
					if (!result_cmd.services.pressure) {
						result_cmd.services.pressure = [];
					}
					if (!result_cmd.services.pressure[i]) {
						result_cmd.services.pressure[i] = {};
					}
					result_cmd.services.pressure[i].pressure = cmds[i];
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
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"cmd::execCmd","params":{"apikey":"' + that.apikey + '","id":"' + ID + '"' + options + ',"session":true,"sess_id":"'+ that.sess_id +'"}}'
			}
		}, function(err, response, json) {
			if (!err && (response.statusCode == 200 || response.statusCode == 202)){
				if(!json.result && json.error)
					reject(json.error);
				else {
					if(json.sess_id !== undefined)
						that.sess_id = json.sess_id;
					else
						that.sess_id = "";
					resolve(json.result);
				}
			}
			else
				reject(err);
		});
	});
};

JeedomClient.prototype.executeScenarioAction = function(ID, action) {
	var that = this;
	
	return new Promise(function(resolve, reject) {
		var url = that.url;
		var request_id = Math.floor(Math.random() * 1000);
		request.post(url, {
			json : true,
			form : {
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"scenario::changeState","params":{"apikey":"' + that.apikey + '","id":"' + ID + '","state":"' + action + '","session":true,"sess_id":"'+ that.sess_id +'"}}'
			}
		}, function(err, response, json) {
			if (!err && (response.statusCode == 200 || response.statusCode == 202))
				if(!json.result && json.error)
					reject(json.error);
				else {
					if(json.sess_id !== undefined)
						that.sess_id = json.sess_id;
					else
						that.sess_id = "";
					resolve(json.result);
				}
			else
				reject(err);
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
				request : '{"jsonrpc":"2.0","id":"'+request_id+'","method":"event::changes","params":{"apikey":"' + that.apikey + '","longPolling":"30","datetime" : "' + that.Plateform.lastPoll + '","filter":"homebridge","session":true,"sess_id":"'+ that.sess_id +'"}}'
			}
		}, function(err, response, json) {
			if (!err && response.statusCode == 200) {
				if(!json.result && json.error)
					reject(json.error);
				else {
					if(json.sess_id !== undefined)
						that.sess_id = json.sess_id;
					else
						that.sess_id = "";
					resolve(json.result);
				}
			} else {
				reject(err);
			}
		});
	});
};

function isset() {
	var a = arguments, l = a.length, i = 0;

	if (l === 0) {
		throw new Error('Empty isset');
	}

	while (i !== l) {
		if (!a[i]) {
			return false;
		}
		i++;
	}
	return true;
}

module.exports.createClient = function(url, apikey, Plateform,myPlugin) {
	return new JeedomClient(url, apikey, Plateform,myPlugin);
};
