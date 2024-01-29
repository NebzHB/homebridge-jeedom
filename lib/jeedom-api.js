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
/* jshint esversion: 11,node: true */
'use strict';
const axios = require('axios');
const async = require('async');
var DEV_DEBUG;
var USE_QUEUES; 

function JeedomClient(url, apikey, Plateform, myPlugin) {
	this.apikey = apikey;
	this.url = url + '/core/api/jeeApi.php';
	this._cachedModel = {}; // .objects || .eqLogics || .cmds || .scenarios
	this.Plateform = Plateform;
	this.log = this.Plateform.log;
	this.myPlugin = myPlugin || "mobile";
	DEV_DEBUG = Plateform.DEV_DEBUG || false;
	USE_QUEUES = Plateform.USE_QUEUES || 1; // 0 = NO, or 1 or 2 etc for the concurrent tasks
	this.queue = async.queue((task, callback) => {
		if(task.type==='cmd') {
			this._executeDeviceAction(task.ID, task.action, task.param)
			.then((result) => callback(null, result))
			.catch((err) => callback(err, null));
		} else if(task.type==='scenario') {
			this._executeScenarioAction(task.ID, task.action)
			.then((result) => callback(null, result))
			.catch((err) => callback(err, null));
		}
	}, ((USE_QUEUES===0)?1:USE_QUEUES));
}

JeedomClient.prototype.changeQueueSys = function(newVal = 1) {
	USE_QUEUES = newVal;
	this.queue.concurrency = ((USE_QUEUES===0)?1:USE_QUEUES);
};

JeedomClient.prototype.getModel = function() {
	var that = this;
	var url = that.url;
	
	return axios.post(url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"sync_homebridge",
		params:{
			plugin:that.myPlugin,
			apikey:that.apikey,
		},
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else {
			that._cachedModel=result.data.result;
			return that._cachedModel;
		}
	});
};

JeedomClient.prototype.getDevicePropertiesFromCache = function(ID) {
	var that = this;
	for (var e in that._cachedModel.eqLogics) {
		if (that._cachedModel.eqLogics.hasOwnProperty(e)) {
			var eqLogic = that._cachedModel.eqLogics[e];
			if(eqLogic.id == ID) {
				return eqLogic;
			}
		}
	}
	return null;
};

JeedomClient.prototype.getDeviceProperties = function(ID) {
	var that = this;
	var url = that.url;
	
	return axios.post(url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"getEql",
		params:{
			plugin:that.myPlugin,
			apikey:that.apikey,
			id:ID,
		},
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else if(result.data.result != 'ok') {
			return result.data.result;
		} else {
			return Promise.reject("EqLogic "+ID+" n'existe pas ou pas envoyé à homebridge");
		}
	});

};

JeedomClient.prototype.daemonIsReady = function(port) {
	var that = this;
	var url = that.url;
	
	return axios.post(url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"daemonIsReady",
		params:{
			plugin:that.myPlugin,
			apikey:that.apikey,
			port:port,
		},
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else if(result.data.result == true) {
			return result.data.result;
		} else {
			return Promise.reject("Jeedom n'a pas compris l'envoi du port");
		}
	});

};

JeedomClient.prototype.getDeviceCmdFromCache = function(ID) {
	var that = this;
	var clist = [];
	for (var c in that._cachedModel.cmds) {
		if (that._cachedModel.cmds.hasOwnProperty(c)) {
			var cmd = that._cachedModel.cmds[c];
			if(cmd.eqLogic_id == ID) {
				clist.push(cmd);
			}
		}
	}
	return clist;
};

JeedomClient.prototype.getScenarioPropertiesFromCache = function(ID) {
	var that = this;
	for (var s in that._cachedModel.scenarios) {
		if (that._cachedModel.scenarios.hasOwnProperty(s)) {
			var scenario = that._cachedModel.scenarios[s];
			if(scenario.id == ID) {
				return scenario;
			}
		}
	}
	return null;
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

JeedomClient.prototype.updateModelInfo = function(ID,value,internal=false) {
	var that = this;
	var eq;
	for (var c in that._cachedModel.cmds) {
		if (that._cachedModel.cmds.hasOwnProperty(c)) {
			var cmd = that._cachedModel.cmds[c];
			if(cmd.id == ID && cmd.type=='info') {
				eq = that.getDevicePropertiesFromCache(cmd.eqLogic_id);
				if(!internal) { that.log('info','[Maj reçue de Jeedom] commande:'+ID+' value:'+value); }
				else { that.log('info','[Maj interne] commande:'+ID+' value:'+value); }
				that.log('info','[[Modification Cache Jeedom: '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') de '+cmd.currentValue+' vers '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
				if(cmd.generic_type == 'ALARM_STATE') {
					if(cmd.currentValue != value) {
						cmd.currentValue=value;
						return true;
					} else {
						return false; // do not send an event if value haven't changed !
					}
				} else {
					cmd.currentValue=value;
					return true;
				}
			} else if (cmd.id == ID) {
				if(DEV_DEBUG) {
					eq = that.getDevicePropertiesFromCache(cmd.eqLogic_id);
					that.log('debug','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
					that.log('debug','[[Pas une commande INFO ('+cmd.type+') '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
				}
				return false;
			}
		}
	}
	if(DEV_DEBUG) {
		that.log('debug','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
		that.log('debug','Commande pas trouvée dans le cache jeedom (non visible ou pas envoyé à homebridge): '+ID);
	}
	return false;
};

JeedomClient.prototype.executeDeviceAction = function(ID, action, param) {
	if(USE_QUEUES === 0) { return this._executeDeviceAction(ID, action, param); }
	return new Promise((resolve, reject) => {
		this.queue.push({ID, action, param, type:'cmd'}, (err, result) => {
			if (err) { reject(err); }
			else { resolve(result); }
		});
	});
};

JeedomClient.prototype._executeDeviceAction = function(ID, action, param) {
	var that = this;
	var options = {};
	var url = that.url;
	// console.log('params : ' + param);
	if (param != null) {
		if (action == 'setRGB') {
			options = {color:param};
		} else if (action == 'GBtoggleSelect') {
			options = {select:param};
		} else if (!isNaN(parseInt(param)) && parseInt(param) == param) {
			options = {slider:parseInt(param)};
		} else if (!isNaN(parseFloat(param)) && parseFloat(param) == param) {
			options = {slider:parseFloat(param)};
		}
	}
	
	return axios.post(url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"cmd::execCmd",
		params:{
			apikey:that.apikey,
			id:ID,
			options:options,
		},
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else {
			return result.data.result;
		}
	});
};

JeedomClient.prototype.executeScenarioAction = function(ID, action) {
	if(USE_QUEUES === 0) { return this._executeScenarioAction(ID, action); }
	return new Promise((resolve, reject) => {
		this.queue.push({ID, action, type:'scenario'}, (err, result) => {
			if (err) { reject(err); }
			else { resolve(result); }
		});
	});
};

JeedomClient.prototype._executeScenarioAction = function(ID, action) {
	var that = this;
	var url = that.url;
	
	return axios.post(url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"scenario::changeState",
		params:{
			apikey:that.apikey,
			id:ID,
			state:action,
		},
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else {
			return result.data.result;
		}
	});
};

JeedomClient.prototype.refreshStates = function() {
	var that = this;
	var url = that.url;
	
	return axios.post(url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"event::changes",
		params:{
			apikey:that.apikey,
			longPolling:30,
			datetime:that.Plateform.lastPoll,
			filter:"homebridge",
		},
	},{
		timeout: 70000,
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else {
			return result.data.result;
		}
	});
};

function initServ(result_cmd, serviceType, property, value, isPush = false) {
    result_cmd.services[serviceType] ??= [];
	const service = {};
    if (isPush) {
        service[property] ??= [];
        service[property].push(value);
    } else {
        service[property] = value;
    }
	result_cmd.services[serviceType].push(service);
}

JeedomClient.prototype.ParseGenericType = function(EqLogic, cmds) {
	const result_cmd = {...EqLogic, services: {}, numSwitches: 0, numDetector: 0};
	
	cmds.forEach((cmd) => {
		if (cmd.generic_type !== null) {
			switch(cmd.generic_type) {
				case 'SHOCK' :
				case 'RAIN_CURRENT' :
				case 'RAIN_TOTAL' :
				case 'WIND_SPEED' :
				case 'WIND_DIRECTION' :
				case 'GENERIC_INFO':
					initServ(result_cmd,'generic','state',cmd);
					break;
				/** *************** MODE ***********************/	
				case 'MODE_STATE' :
					initServ(result_cmd,'mode','state',cmd);
					break;
				case 'MODE_SET_STATE' :
					if(cmd.logicalId=="returnPreviousMode") {
						initServ(result_cmd,'mode','set_state_previous',cmd);
					} else {
						initServ(result_cmd,'mode','set_state',cmd,true);
					}
					break;
				/** *************** LIGHT ***********************/
				case 'LIGHT_STATE' :
					initServ(result_cmd,'light','state',cmd);
					break;
				case 'LIGHT_BRIGHTNESS' :
					initServ(result_cmd,'light','brightness',cmd);
					break;
				case 'LIGHT_STATE_BOOL' :
					initServ(result_cmd,'light','state_bool',cmd);
					break;
				case 'LIGHT_ON' :
					initServ(result_cmd,'light','on',cmd);
					break;
				case 'LIGHT_OFF' :
					initServ(result_cmd,'light','off',cmd);
					break;
				case 'LIGHT_SLIDER' :
					initServ(result_cmd,'light','slider',cmd);
					break;
				case 'LIGHT_COLOR' :
					initServ(result_cmd,'light','color',cmd);
					break;
				case 'LIGHT_COLOR_TEMP' :
					initServ(result_cmd,'light','color_temp',cmd);
					break;
				case 'LIGHT_SET_COLOR' :
					initServ(result_cmd,'light','setcolor',cmd);
					break;
				case 'LIGHT_SET_COLOR_TEMP' :
					initServ(result_cmd,'light','setcolor_temp',cmd);
					break;
				/** *************** WEATHER ***********************/
				case 'WEATHER_TEMPERATURE' :
					initServ(result_cmd,'weather','temperature',cmd);
					break;	
				case 'WEATHER_HUMIDITY' :
					initServ(result_cmd,'weather','humidity',cmd);
					break;
				case 'WEATHER_PRESSURE' :
					initServ(result_cmd,'weather','pressure',cmd);
					break;
				case 'WEATHER_WIND_SPEED' :
					initServ(result_cmd,'weather','wind_speed',cmd);
					break;
				case 'WEATHER_WIND_DIRECTION' :
					initServ(result_cmd,'weather','wind_direction',cmd);
					break;
				case 'WEATHER_CONDITION' :
					initServ(result_cmd,'weather','condition',cmd);
					break;
				case 'WEATHER_UVINDEX' :
					initServ(result_cmd,'weather','UVIndex',cmd);
					break;		
				case 'WEATHER_VISIBILITY' :
					initServ(result_cmd,'weather','visibility',cmd);
					break;
				case 'WEATHER_RAIN' :
					initServ(result_cmd,'weather','rain',cmd);
					break;
				case 'WEATHER_SNOW' :
					initServ(result_cmd,'weather','snow',cmd);
					break;	
				case 'WEATHER_TEMPERATURE_MIN' :
					initServ(result_cmd,'weather','temperature_min',cmd);
					break;
				/** *************** SIREN ***********************/
				case 'SIREN_STATE' :
					initServ(result_cmd,'siren','state',cmd);
					break;
				/* case 'SIREN_ON' :
					initServ(result_cmd,'siren','on',cmd);
					break;
				case 'SIREN_OFF' :
					initServ(result_cmd,'siren','off',cmd);
					break;	*/				
				/** *************** ENERGY ***********************/
				case 'ENERGY_STATE' :
					initServ(result_cmd,'energy','state',cmd);
					break;
				case 'ENERGY_ON' :
					initServ(result_cmd,'energy','on',cmd);
					break;
				case 'ENERGY_OFF' :
					initServ(result_cmd,'energy','off',cmd);
					break;
				case 'ENERGY_INUSE' :
					initServ(result_cmd,'energy','inuse',cmd);
					break;
				/** *************** VALVES ***********************/
				case 'FAUCET_STATE' :
					initServ(result_cmd,'faucet','state',cmd);
					break;
				case 'FAUCET_ON' :
					initServ(result_cmd,'faucet','on',cmd);
					break;
				case 'FAUCET_OFF' :
					initServ(result_cmd,'faucet','off',cmd);
					break;
				case 'IRRIG_STATE' :
					initServ(result_cmd,'irrigation','state',cmd);
					break;
				case 'IRRIG_ON' :
					initServ(result_cmd,'irrigation','on',cmd);
					break;
				case 'IRRIG_OFF' :
					initServ(result_cmd,'irrigation','off',cmd);
					break;
				case 'VALVE_STATE' :
					initServ(result_cmd,'valve','state',cmd);
					break;
				case 'VALVE_ON' :
					initServ(result_cmd,'valve','on',cmd);
					break;
				case 'VALVE_OFF' :
					initServ(result_cmd,'valve','off',cmd);
					break;
				case 'VALVE_SET_DURATION' :
					initServ(result_cmd,'valve','setDuration',cmd);
					break;
				case 'VALVE_REMAINING_DURATION' :
					initServ(result_cmd,'valve','remainingDuration',cmd);
					break;
				/** *************** FAN ***********************/
				case 'FAN_STATE' :
				case 'FAN_SPEED_STATE' :
					initServ(result_cmd,'fan','state',cmd);
					break;
				case 'FAN_ON' :
					initServ(result_cmd,'fan','on',cmd);
					break;
				case 'FAN_OFF' :
					initServ(result_cmd,'fan','off',cmd);
					break;
				case 'FAN_SLIDER' :
				case 'FAN_SPEED' :
					initServ(result_cmd,'fan','slider',cmd);
					break;					
				/** *************** SWITCH ***********************/
				case 'SWITCH_STATE' :
				case 'CAMERA_RECORD_STATE' :
					initServ(result_cmd,'Switch','state',cmd);
					result_cmd.numSwitches++;
					break;
				case 'SWITCH_ON' :
				case 'CAMERA_RECORD' :
					initServ(result_cmd,'Switch','on',cmd);
					break;
				case 'SWITCH_OFF' :
				case 'CAMERA_STOP' :
					initServ(result_cmd,'Switch','off',cmd);
					break;
				/** *************** SWITCH ***********************/
				case 'GENERIC_ACTION' :
					if(cmd.subType=="other") {
						initServ(result_cmd,'Push','Push',cmd);
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
					initServ(result_cmd,'Push','Push',cmd);
					break;
				/** *************** BARRIER/GARAGE**************/
				case "BARRIER_STATE" :
				case "GARAGE_STATE" :
					initServ(result_cmd,'GarageDoor','state',cmd);
					break;
				case "GB_OPEN" : // should not be used
					initServ(result_cmd,'GarageDoor','on',cmd);
					break;
				case "GB_CLOSE" : // should not be used
					initServ(result_cmd,'GarageDoor','off',cmd);
					break;
				case "GB_TOGGLE" :
					initServ(result_cmd,'GarageDoor','toggle',cmd);
					break;
				/** *************** LOCK ***********************/
				case 'LOCK_STATE' :
					initServ(result_cmd,'lock','state',cmd);
					break;
				case 'LOCK_OPEN' :
					initServ(result_cmd,'lock','on',cmd);
					break;
				case 'LOCK_CLOSE' :
					initServ(result_cmd,'lock','off',cmd);
					break;
				/** *************** StatelessSwitch ******************/
				case 'SWITCH_STATELESS_ALLINONE' :
					initServ(result_cmd,'StatelessSwitch','eventType',cmd);
					break;
				case 'SWITCH_STATELESS_SINGLE' :
					initServ(result_cmd,'StatelessSwitchMono','Single',cmd);
					break;
				case 'SWITCH_STATELESS_DOUBLE' :
					initServ(result_cmd,'StatelessSwitchMono','Double',cmd);
					break;
				case 'SWITCH_STATELESS_LONG' :
					initServ(result_cmd,'StatelessSwitchMono','Long',cmd);
					break;
				/** *************** FLAP ***********************/
				case 'FLAP_STATE' :
					initServ(result_cmd,'flap','state',cmd);
					break;
				case 'FLAP_STATE_CLOSING' :
					initServ(result_cmd,'flap','stateClosing',cmd);
					break;
				case 'FLAP_UP' :
					initServ(result_cmd,'flap','up',cmd);
					break;
				case 'FLAP_DOWN' :
					initServ(result_cmd,'flap','down',cmd);
					break;
				case 'FLAP_SLIDER' :
					initServ(result_cmd,'flap','slider',cmd);
					break;
				case 'FLAP_STOP' :
					initServ(result_cmd,'flap','stop',cmd);
					break;
				case 'FLAP_HOR_TILT_STATE' :
					initServ(result_cmd,'flap','HorTiltState',cmd);
					break;	
				case 'FLAP_HOR_TILT_SLIDER' :
					initServ(result_cmd,'flap','HorTiltSlider',cmd);
					break;	
				case 'FLAP_VER_TILT_STATE' :
					initServ(result_cmd,'flap','VerTiltState',cmd);
					break;	
				case 'FLAP_VER_TILT_SLIDER' :
					initServ(result_cmd,'flap','VerTiltSlider',cmd);
					break;	
				/** *************** WINDOW ***********************/
				case 'WINDOW_STATE' :
					initServ(result_cmd,'windowMoto','state',cmd);
					break;
				case 'WINDOW_UP' :
					initServ(result_cmd,'windowMoto','up',cmd);
					break;
				case 'WINDOW_DOWN' :
					initServ(result_cmd,'windowMoto','down',cmd);
					break;
				case 'WINDOW_SLIDER' :
					initServ(result_cmd,'windowMoto','slider',cmd);
					break;
				/** ************* THERMOSTAT ***********************/
				case 'THERMOSTAT_STATE' :
					initServ(result_cmd,'thermostat','state',cmd);
					break;
				case 'THERMOSTAT_STATE_NAME' :
					initServ(result_cmd,'thermostat','state_name',cmd);
					break;
				case 'THERMOSTAT_TEMPERATURE' :
					initServ(result_cmd,'thermostat','temperature',cmd);
					break;
				case 'THERMOSTAT_SET_SETPOINT' :
					initServ(result_cmd,'thermostat','set_setpoint',cmd);
					break;
				case 'THERMOSTAT_SETPOINT' :
					initServ(result_cmd,'thermostat','setpoint',cmd);
					break;
				case 'THERMOSTAT_SET_MODE' :
					initServ(result_cmd,'thermostat','set_mode',cmd);
					break;
				case 'THERMOSTAT_MODE' :
					initServ(result_cmd,'thermostat','mode',cmd);
					break;
				case 'THERMOSTAT_LOCK' :
					initServ(result_cmd,'thermostat','lock',cmd);
					break;
				case 'THERMOSTAT_SET_LOCK' :
					initServ(result_cmd,'thermostat','set_lock',cmd);
					break;
				case 'THERMOSTAT_SET_UNLOCK' :
					initServ(result_cmd,'thermostat','set_unlock',cmd);
					break;
				case 'THERMOSTAT_TEMPERATURE_OUTDOOR' :
					initServ(result_cmd,'thermostat','temperature_outdoor',cmd);
					break;
				/** ************* THERMOSTAT_HC ***********************/
				case 'THERMOSTAT_HC_STATE' :
					initServ(result_cmd,'thermostatHC','state',cmd);
					break;
				case 'THERMOSTAT_HC_STATE_NAME' :
					initServ(result_cmd,'thermostatHC','state_name',cmd);
					break;
				case 'THERMOSTAT_HC_TEMPERATURE' :
					initServ(result_cmd,'thermostatHC','temperature',cmd);
					break;
				case 'THERMOSTAT_HC_SET_SETPOINT_H' :
					initServ(result_cmd,'thermostatHC','set_setpointH',cmd);
					break;
				case 'THERMOSTAT_HC_SET_SETPOINT_C' :
					initServ(result_cmd,'thermostatHC','set_setpointC',cmd);
					break;
				case 'THERMOSTAT_HC_SETPOINT_H' :
					initServ(result_cmd,'thermostatHC','setpointH',cmd);
					break;
				case 'THERMOSTAT_HC_SETPOINT_C' :
					initServ(result_cmd,'thermostatHC','setpointC',cmd);
					break;
				case 'THERMOSTAT_HC_SET_MODE' :
					initServ(result_cmd,'thermostatHC','set_mode',cmd);
					break;
				case 'THERMOSTAT_HC_MODE' :
					initServ(result_cmd,'thermostatHC','mode',cmd);
					break;
				case 'THERMOSTAT_HC_LOCK' :
					initServ(result_cmd,'thermostatHC','lock',cmd);
					break;
				case 'THERMOSTAT_HC_SET_LOCK' :
					initServ(result_cmd,'thermostatHC','set_lock',cmd);
					break;
				case 'THERMOSTAT_HC_SET_UNLOCK' :
					initServ(result_cmd,'thermostatHC','set_unlock',cmd);
					break;
				/** ************* ALARME ***********************/
				case 'ALARM_STATE' :
					initServ(result_cmd,'alarm','state',cmd);
					break;
				case 'ALARM_MODE' :
					initServ(result_cmd,'alarm','mode',cmd);
					break;
				case 'ALARM_ENABLE_STATE' :
					initServ(result_cmd,'alarm','enable_state',cmd);
					break;
				case 'ALARM_ARMED' :
					initServ(result_cmd,'alarm','armed',cmd);
					break;
				case 'ALARM_RELEASED' :
					initServ(result_cmd,'alarm','released',cmd);
					break;
				case 'ALARM_SET_MODE' :
					initServ(result_cmd,'alarm','set_mode',cmd);
					break;
				/** *************** GENERIC ***********************/
				case 'AIRQUALITY_INDEX' :
					initServ(result_cmd,'AirQuality','Index',cmd);
					break;
				case 'AIRQUALITY_PM25' :
					initServ(result_cmd,'AirQuality','PM25',cmd);
					break;
				case 'AIRQUALITY_CUSTOM' :
					initServ(result_cmd,'AirQualityCustom','Index',cmd);
					break;
				case 'NOISE' :
					initServ(result_cmd,'Noise','Noise',cmd);
					break;
				case 'CO2' :
					initServ(result_cmd,'CO2','CO2',cmd);
					break;
				case 'CO' :
					initServ(result_cmd,'CO','CO',cmd);
					break;
				case 'OPENING_WINDOW' :
				case 'OPENING' :
					initServ(result_cmd,'opening','opening',cmd);
					break;
				case 'BATTERY' :
					initServ(result_cmd,'battery','battery',cmd);
					break;
				case 'BATTERY_CHARGING' : // not existing yet
					initServ(result_cmd,'battery','batteryCharging',cmd);
					break;
				case 'DEFECT' :
					initServ(result_cmd,'defect','defect',cmd);
					break;
				case 'PRESENCE' :
					initServ(result_cmd,'presence','presence',cmd);
					result_cmd.numDetector++;
					break;
				case 'OCCUPANCY' :
					initServ(result_cmd,'occupancy','occupancy',cmd);
					result_cmd.numDetector++;
					break;
				case 'TEMPERATURE' :
					initServ(result_cmd,'temperature','temperature',cmd);
					break;
				case 'BRIGHTNESS' :
					initServ(result_cmd,'brightness','brightness',cmd);
					break;
				case 'SMOKE' :
					initServ(result_cmd,'smoke','smoke',cmd);
					break;
				case 'UV' : // via custom
					initServ(result_cmd,'uv','uv',cmd);
					break;
				case 'HUMIDITY' :
					initServ(result_cmd,'humidity','humidity',cmd);
					break;
				case 'SABOTAGE' :
					initServ(result_cmd,'sabotage','sabotage',cmd);
					break;
				case 'FLOOD' :
				case 'WATER_LEAK' :
					initServ(result_cmd,'flood','flood',cmd);
					break;
				case 'POWER' : // via custom
					initServ(result_cmd,'power','power',cmd);
					break;
				case 'CONSUMPTION' : // via custom
					initServ(result_cmd,'consumption','consumption',cmd);
					break;
				case 'ACTIVE' :
					initServ(result_cmd,'status_active','status_active',cmd);
					break;
				case 'SPEAKER_VOLUME' :
				case 'VOLUME' :
					initServ(result_cmd,'speaker','volume',cmd);
					break;
				case 'SPEAKER_SET_VOLUME' :
				case 'SET_VOLUME' :
					initServ(result_cmd,'speaker','set_volume',cmd);
					break;
				case 'SPEAKER_MUTE' :
					initServ(result_cmd,'speaker','mute',cmd);
					break;
				case 'SPEAKER_MUTE_TOGGLE' :
					initServ(result_cmd,'speaker','mute_toggle',cmd);
					break;
				case 'SPEAKER_MUTE_ON' :
					initServ(result_cmd,'speaker','mute_on',cmd);
					break;
				case 'SPEAKER_MUTE_OFF' :
					initServ(result_cmd,'speaker','mute_off',cmd);
					break;
				case 'PRESSURE' :
					initServ(result_cmd,'pressure','pressure',cmd);
					break;
			}
		}
	});
	return result_cmd;
};

module.exports.createClient = function(url, apikey, Plateform,myPlugin) {
	return new JeedomClient(url, apikey, Plateform,myPlugin);
};
