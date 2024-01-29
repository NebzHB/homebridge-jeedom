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
	return axios.post(this.url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"sync_homebridge",
		params:{
			plugin:this.myPlugin,
			apikey:this.apikey,
		},
	}).then((result) => {
		if(!result.data) {return Promise.reject("JSON reçu de Jeedom invalide, vérifiez le log API de Jeedom, reçu :"+JSON.stringify(result));}
		if(!result.data.result && result.data.error) {
			return Promise.reject(result.data.error.message);
		} else {
			this._cachedModel=result.data.result;
			return this._cachedModel;
		}
	});
};

JeedomClient.prototype.getDevicePropertiesFromCache = function(ID) {
	for (const e in this._cachedModel.eqLogics) {
		if(this._cachedModel.eqLogics[e].id == ID) {
			return this._cachedModel.eqLogics[e];
		}
	}
	return null;
};

JeedomClient.prototype.getDeviceProperties = function(ID) {
	return axios.post(this.url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"getEql",
		params:{
			plugin:this.myPlugin,
			apikey:this.apikey,
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
	return axios.post(this.url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"daemonIsReady",
		params:{
			plugin:this.myPlugin,
			apikey:this.apikey,
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
	const clist = [];
	for (const c in this._cachedModel.cmds) {
		if (this._cachedModel.cmds[c].eqLogic_id == ID) {
            clist.push(this._cachedModel.cmds[c]);
        }
	}
	return clist;
};

JeedomClient.prototype.getScenarioPropertiesFromCache = function(ID) {
	for (const s in this._cachedModel.scenarios) {
		if(this._cachedModel.scenarios[s].id == ID) {
			return this._cachedModel.scenarios[s];
		}
	}
	return null;
};

JeedomClient.prototype.updateModelScenario = function(ID,state) {
	for (const s in this._cachedModel.scenarios) {
		if(this._cachedModel.scenarios[s].id == ID) {
			this.log('debug','[[Modification Cache Jeedom scenarios: '+this._cachedModel.scenarios[s].name+'> State de '+this._cachedModel.scenarios[s].state+' vers '+state+' dans ' + JSON.stringify(this._cachedModel.scenarios[s]).replace('\n',''));
			this._cachedModel.scenarios[s].state=state;
			return this._cachedModel.scenarios[s];
		} 
	}
	this.log('debug','Scénario pas trouvée dans le cache jeedom (Nouveau Scénario, redémarrez le démon Homebridge pour prendre en compte): '+ID);
	return null;
};

JeedomClient.prototype.updateModelEq = function(ID,eqLogic) {
	for (const e in this._cachedModel.eqLogics) {
		if(this._cachedModel.eqLogics[e].id == ID) {
			this.log('info','[[Modification Cache Jeedom eqLogic: '+this._cachedModel.eqLogics[e].name+'>'+eqLogic.name+' Enable de '+this._cachedModel.eqLogics[e].isEnable+' vers '+eqLogic.isEnable+' dans ' + JSON.stringify(eqLogic).replace('\n',''));
			this._cachedModel.eqLogics[e].isEnable=eqLogic.isEnable;
			return eqLogic;
		} 
	}
	if(DEV_DEBUG) {
		this.log('debug','Eqlogic pas trouvée dans le cache jeedom (non visible ou pas envoyé à homebridge): '+ID);
	}
	return null;
};

JeedomClient.prototype.updateModelInfo = function(ID,value,internal=false) {
	for (const c in this._cachedModel.cmds) {
			const cmd = this._cachedModel.cmds[c];
			let eq;
			if(cmd.id == ID && cmd.type=='info') {
				eq = this.getDevicePropertiesFromCache(cmd.eqLogic_id);
				if(!internal) {this.log('info','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);}
				else {this.log('info','[Maj interne] commande:'+ID+' value:'+value);}
				this.log('info','[[Modification Cache Jeedom: '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') de '+cmd.currentValue+' vers '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
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
					eq = this.getDevicePropertiesFromCache(cmd.eqLogic_id);
					this.log('debug','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
					this.log('debug','[[Pas une commande INFO ('+cmd.type+') '+eq.name+'>'+cmd.name+'('+cmd.generic_type+') '+value+' dans ' + JSON.stringify(cmd).replace('\n',''));
				}
				return false;
			}
	}
	if(DEV_DEBUG) {
		this.log('debug','[Maj reçue de Jeedom] commande:'+ID+' value:'+value);
		this.log('debug','Commande pas trouvée dans le cache jeedom (non visible ou pas envoyé à homebridge): '+ID);
	}
	return false;
};

JeedomClient.prototype.executeDeviceAction = function(ID, action, param) {
	if(USE_QUEUES === 0) {return this._executeDeviceAction(ID, action, param);}
	return new Promise((resolve, reject) => {
		this.queue.push({ID, action, param, type:'cmd'}, (err, result) => {
			if (err) {reject(err);}
			else {resolve(result);}
		});
	});
};

JeedomClient.prototype._executeDeviceAction = function(ID, action, param) {
	var options = {};
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
	
	return axios.post(this.url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"cmd::execCmd",
		params:{
			apikey:this.apikey,
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
	if(USE_QUEUES === 0) {return this._executeScenarioAction(ID, action);}
	return new Promise((resolve, reject) => {
		this.queue.push({ID, action, type:'scenario'}, (err, result) => {
			if (err) {reject(err);}
			else {resolve(result);}
		});
	});
};

JeedomClient.prototype._executeScenarioAction = function(ID, action) {
	return axios.post(this.url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"scenario::changeState",
		params:{
			apikey:this.apikey,
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
	return axios.post(this.url, 
	{
		jsonrpc:"2.0",
		id:(Math.floor(Math.random() * 1000)),
		method:"event::changes",
		params:{
			apikey:this.apikey,
			longPolling:30,
			datetime:this.Plateform.lastPoll,
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

function initServ(result_cmd, value, serviceType, property, isPush = false) {
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
			
			if(cmd.generic_type === 'MODE_SET_STATE') {
				if(cmd.logicalId === "returnPreviousMode") {
					initServ(result_cmd,cmd,'mode','set_state_previous');
				} else {
					initServ(result_cmd,cmd,'mode','set_state',true);
				}
				return;
			} else if(cmd.generic_type === 'GENERIC_ACTION') {
				if(cmd.subType=="other") {
					initServ(result_cmd,cmd,'Push','Push');
				}
				return;
			}
			
			const serviceInfo = genTypesMapping[cmd.generic_type];
			if(!serviceInfo) {return;}
			initServ(result_cmd, cmd, serviceInfo.serviceType, serviceInfo.property, serviceInfo.isPush || false);

			if(cmd.generic_type === 'PRESENCE') {
				result_cmd.numDetector++;
			} else if(cmd.generic_type === 'OCCUPANCY') {
				result_cmd.numDetector++;
			} else if(cmd.generic_type === 'SWITCH_STATE' || cmd.generic_type === 'CAMERA_RECORD_STATE') {
				result_cmd.numSwitches++;
			}
		}
	});
	return result_cmd;
};

const genTypesMapping = {
	// *************** MODE ***********************
	'MODE_STATE':		{serviceType: 'mode', property: 'state'},
	
	// *************** LIGHT ***********************
	'LIGHT_STATE': 		{serviceType: 'light', property: 'state'},
	'LIGHT_BRIGHTNESS': 	{serviceType: 'light', property: 'brightness'},
	'LIGHT_STATE_BOOL': 	{serviceType: 'light', property: 'state_bool'},
	'LIGHT_ON': 		{serviceType: 'light', property: 'on'},
	'LIGHT_OFF': 		{serviceType: 'light', property: 'off'},
	'LIGHT_SLIDER': 	{serviceType: 'light', property: 'slider'},
	'LIGHT_COLOR': 		{serviceType: 'light', property: 'color'},
	'LIGHT_COLOR_TEMP': 	{serviceType: 'light', property: 'color_temp'},
	'LIGHT_SET_COLOR': 	{serviceType: 'light', property: 'setcolor'},
	'LIGHT_SET_COLOR_TEMP': {serviceType: 'light', property: 'setcolor_temp'},
	
	// *************** WEATHER ***********************
	'WEATHER_TEMPERATURE': 		{serviceType: 'weather', property: 'temperature'},
	'WEATHER_HUMIDITY': 		{serviceType: 'weather', property: 'humidity'},
	'WEATHER_PRESSURE': 		{serviceType: 'weather', property: 'pressure'},
	'WEATHER_WIND_SPEED': 		{serviceType: 'weather', property: 'wind_speed'},
	'WEATHER_WIND_DIRECTION': 	{serviceType: 'weather', property: 'wind_direction'},
	'WEATHER_CONDITION': 		{serviceType: 'weather', property: 'condition'},
	'WEATHER_UVINDEX': 		{serviceType: 'weather', property: 'UVIndex'},
	'WEATHER_VISIBILITY': 		{serviceType: 'weather', property: 'visibility'},
	'WEATHER_RAIN': 		{serviceType: 'weather', property: 'rain'},
	'WEATHER_SNOW': 		{serviceType: 'weather', property: 'snow'},
	'WEATHER_TEMPERATURE_MIN': 	{serviceType: 'weather', property: 'temperature_min'},
	
	// *************** SIREN ***********************
	'SIREN_STATE': {serviceType: 'siren', property: 'state'},
	// 'SIREN_ON': {serviceType: 'siren', property: 'on'},
	// 'SIREN_OFF': {serviceType: 'siren', property: 'off'},
	
	// *************** ENERGY ***********************
	'ENERGY_STATE': {serviceType: 'energy', property: 'state'},
	'ENERGY_ON': 	{serviceType: 'energy', property: 'on'},
	'ENERGY_OFF': 	{serviceType: 'energy', property: 'off'},
	'ENERGY_INUSE': {serviceType: 'energy', property: 'inuse'},
	
	// *************** VALVES ***********************
	'FAUCET_STATE': 		{serviceType: 'faucet', property: 'state'},
	'FAUCET_ON': 			{serviceType: 'faucet', property: 'on'},
	'FAUCET_OFF': 			{serviceType: 'faucet', property: 'off'},
	'IRRIG_STATE': 			{serviceType: 'irrigation', property: 'state'},
	'IRRIG_ON': 			{serviceType: 'irrigation', property: 'on'},
	'IRRIG_OFF': 			{serviceType: 'irrigation', property: 'off'},
	'VALVE_STATE': 			{serviceType: 'valve', property: 'state'},
	'VALVE_ON': 			{serviceType: 'valve', property: 'on'},
	'VALVE_OFF': 			{serviceType: 'valve', property: 'off'},
	'VALVE_SET_DURATION': 		{serviceType: 'valve', property: 'setDuration'},
	'VALVE_REMAINING_DURATION': 	{serviceType: 'valve', property: 'remainingDuration'},
	
	// *************** FAN ***********************
	'FAN_STATE': 		{serviceType: 'fan', property: 'state'},
	'FAN_SPEED_STATE': 	{serviceType: 'fan', property: 'state'},
	'FAN_ON': 		{serviceType: 'fan', property: 'on'},
	'FAN_OFF': 		{serviceType: 'fan', property: 'off'},
	'FAN_SLIDER': 		{serviceType: 'fan', property: 'slider'},
	'FAN_SPEED': 		{serviceType: 'fan', property: 'slider'},
	
	// *************** SWITCH ***********************
	'SWITCH_STATE': 	{serviceType: 'Switch', property: 'state'},
	'SWITCH_ON': 		{serviceType: 'Switch', property: 'on'},
	'SWITCH_OFF': 		{serviceType: 'Switch', property: 'off'},
	'CAMERA_RECORD_STATE': 	{serviceType: 'Switch', property: 'state'},
	'CAMERA_RECORD': 	{serviceType: 'Switch', property: 'on'},
	'CAMERA_STOP': 		{serviceType: 'Switch', property: 'off'},
	
	// *************** PUSH ***********************
	'PUSH_BUTTON': 	{serviceType: 'Push', property: 'Push'},
	'CAMERA_UP': 	{serviceType: 'Push', property: 'Push'},
	'CAMERA_DOWN': 	{serviceType: 'Push', property: 'Push'},
	'CAMERA_LEFT': 	{serviceType: 'Push', property: 'Push'},
	'CAMERA_RIGHT': {serviceType: 'Push', property: 'Push'},
	'CAMERA_ZOOM': 	{serviceType: 'Push', property: 'Push'},
	'CAMERA_DEZOOM':{serviceType: 'Push', property: 'Push'},
	'CAMERA_PRESET':{serviceType: 'Push', property: 'Push'},
	
	// *************** BARRIER/GARAGE**************
	'BARRIER_STATE': 	{serviceType: 'GarageDoor', property: 'state'},
	'GARAGE_STATE': 	{serviceType: 'GarageDoor', property: 'state'},
	'GB_OPEN': 		{serviceType: 'GarageDoor', property: 'on'}, // should not be used
	'GB_CLOSE': 		{serviceType: 'GarageDoor', property: 'off'}, // should not be used
	'GB_TOGGLE': 		{serviceType: 'GarageDoor', property: 'toggle'},
	
	// *************** LOCK ***********************
	'LOCK_STATE': 	{serviceType: 'lock', property: 'state'},
	'LOCK_OPEN': 	{serviceType: 'lock', property: 'on'},
	'LOCK_CLOSE': 	{serviceType: 'lock', property: 'off'},
	
	// *************** StatelessSwitch ******************
	'SWITCH_STATELESS_ALLINONE':	{serviceType: 'StatelessSwitch', property: 'eventType'},
	'SWITCH_STATELESS_SINGLE': 	{serviceType: 'StatelessSwitchMono', property: 'Single'},
	'SWITCH_STATELESS_DOUBLE': 	{serviceType: 'StatelessSwitchMono', property: 'Double'},
	'SWITCH_STATELESS_LONG': 	{serviceType: 'StatelessSwitchMono', property: 'Long'},
	
	// *************** FLAP ***********************
	'FLAP_STATE': 		{serviceType: 'flap', property: 'state'},
	'FLAP_STATE_CLOSING': 	{serviceType: 'flap', property: 'stateClosing'},
	'FLAP_UP': 		{serviceType: 'flap', property: 'up'},
	'FLAP_DOWN': 		{serviceType: 'flap', property: 'down'},
	'FLAP_SLIDER': 		{serviceType: 'flap', property: 'slider'},
	'FLAP_STOP': 		{serviceType: 'flap', property: 'stop'},
	'FLAP_HOR_TILT_STATE': 	{serviceType: 'flap', property: 'HorTiltState'},
	'FLAP_HOR_TILT_SLIDER': {serviceType: 'flap', property: 'HorTiltSlider'},
	'FLAP_VER_TILT_STATE': 	{serviceType: 'flap', property: 'VerTiltState'},
	'FLAP_VER_TILT_SLIDER': {serviceType: 'flap', property: 'VerTiltSlider'},
	
	// *************** WINDOW ***********************
	'WINDOW_STATE': {serviceType: 'windowMoto', property: 'state'},
	'WINDOW_UP': 	{serviceType: 'windowMoto', property: 'up'},
	'WINDOW_DOWN': 	{serviceType: 'windowMoto', property: 'down'},
	'WINDOW_SLIDER':{serviceType: 'windowMoto', property: 'slider'},
	
	// ************* THERMOSTAT ***********************
	'THERMOSTAT_STATE': 			{serviceType: 'thermostat', property: 'state'},
	'THERMOSTAT_STATE_NAME': 		{serviceType: 'thermostat', property: 'state_name'},
	'THERMOSTAT_TEMPERATURE': 		{serviceType: 'thermostat', property: 'temperature'},
	'THERMOSTAT_SET_SETPOINT': 		{serviceType: 'thermostat', property: 'set_setpoint'},
	'THERMOSTAT_SETPOINT': 			{serviceType: 'thermostat', property: 'setpoint'},
	'THERMOSTAT_SET_MODE': 			{serviceType: 'thermostat', property: 'set_mode'},
	'THERMOSTAT_MODE': 			{serviceType: 'thermostat', property: 'mode'},
	'THERMOSTAT_LOCK': 			{serviceType: 'thermostat', property: 'lock'},
	'THERMOSTAT_SET_LOCK': 			{serviceType: 'thermostat', property: 'set_lock'},
	'THERMOSTAT_SET_UNLOCK': 		{serviceType: 'thermostat', property: 'set_unlock'},
	'THERMOSTAT_TEMPERATURE_OUTDOOR': 	{serviceType: 'thermostat', property: 'temperature_outdoor'},

	// ************* THERMOSTAT_HC ***********************
	'THERMOSTAT_HC_STATE': 			{serviceType: 'thermostatHC', property: 'state'},
	'THERMOSTAT_HC_STATE_NAME': 		{serviceType: 'thermostatHC', property: 'state_name'},
	'THERMOSTAT_HC_TEMPERATURE': 		{serviceType: 'thermostatHC', property: 'temperature'},
	'THERMOSTAT_HC_SET_SETPOINT_H': 	{serviceType: 'thermostatHC', property: 'set_setpointH'},
	'THERMOSTAT_HC_SET_SETPOINT_C': 	{serviceType: 'thermostatHC', property: 'set_setpointC'},
	'THERMOSTAT_HC_SETPOINT_H': 		{serviceType: 'thermostatHC', property: 'setpointH'},
	'THERMOSTAT_HC_SETPOINT_C': 		{serviceType: 'thermostatHC', property: 'setpointC'},
	'THERMOSTAT_HC_SET_MODE': 		{serviceType: 'thermostatHC', property: 'set_mode'},
	'THERMOSTAT_HC_MODE': 			{serviceType: 'thermostatHC', property: 'mode'},
	'THERMOSTAT_HC_LOCK': 			{serviceType: 'thermostatHC', property: 'lock'},
	'THERMOSTAT_HC_SET_LOCK': 		{serviceType: 'thermostatHC', property: 'set_lock'},
	'THERMOSTAT_HC_SET_UNLOCK': 		{serviceType: 'thermostatHC', property: 'set_unlock'},

	// ************* ALARME ***********************
	'ALARM_STATE': 		{serviceType: 'alarm', property: 'state'},
	'ALARM_MODE': 		{serviceType: 'alarm', property: 'mode'},
	'ALARM_ENABLE_STATE': 	{serviceType: 'alarm', property: 'enable_state'},
	'ALARM_ARMED': 		{serviceType: 'alarm', property: 'armed'},
	'ALARM_RELEASED': 	{serviceType: 'alarm', property: 'released'},
	'ALARM_SET_MODE': 	{serviceType: 'alarm', property: 'set_mode'},
	
	// ************* SPEAKER ***********************
	'SPEAKER_VOLUME': 	{serviceType: 'speaker', property: 'volume'},
	'VOLUME': 		{serviceType: 'speaker', property: 'volume'},
	'SPEAKER_SET_VOLUME': 	{serviceType: 'speaker', property: 'set_volume'},
	'SET_VOLUME': 		{serviceType: 'speaker', property: 'set_volume'},
	'SPEAKER_MUTE': 	{serviceType: 'speaker', property: 'mute'},
	'SPEAKER_MUTE_TOGGLE': 	{serviceType: 'speaker', property: 'mute_toggle'},
	'SPEAKER_MUTE_ON': 	{serviceType: 'speaker', property: 'mute_on'},
	'SPEAKER_MUTE_OFF': 	{serviceType: 'speaker', property: 'mute_off'},
	
	// *************** GENERIC ***********************
	'AIRQUALITY_INDEX': 	{serviceType: 'AirQuality', property: 'Index'},
	'AIRQUALITY_PM25': 	{serviceType: 'AirQuality', property: 'PM25'},
	'AIRQUALITY_CUSTOM':	{serviceType: 'AirQualityCustom', property: 'Index'},
	'NOISE': 		{serviceType: 'Noise', property: 'Noise'},
	'CO2': 			{serviceType: 'CO2', property: 'CO2'},
	'CO': 			{serviceType: 'CO', property: 'CO'},
	'OPENING_WINDOW': 	{serviceType: 'opening', property: 'opening'},
	'OPENING': 		{serviceType: 'opening', property: 'opening'},
	'BATTERY': 		{serviceType: 'battery', property: 'battery'},
	'BATTERY_CHARGING': 	{serviceType: 'battery', property: 'batteryCharging'}, // not existing yet
	'DEFECT': 		{serviceType: 'defect', property: 'defect'},
	'PRESENCE': 		{serviceType: 'presence', property: 'presence'},
	'OCCUPANCY': 		{serviceType: 'occupancy', property: 'occupancy'},
	'TEMPERATURE': 		{serviceType: 'temperature', property: 'temperature'},
	'BRIGHTNESS': 		{serviceType: 'brightness', property: 'brightness'},
	'SMOKE': 		{serviceType: 'smoke', property: 'smoke'},
	'UV': 			{serviceType: 'uv', property: 'uv'}, // via custom
	'HUMIDITY': 		{serviceType: 'humidity', property: 'humidity'},
	'SABOTAGE': 		{serviceType: 'sabotage', property: 'sabotage'},
	'FLOOD': 		{serviceType: 'flood', property: 'flood'},
	'WATER_LEAK': 		{serviceType: 'flood', property: 'flood'},
	'POWER': 		{serviceType: 'power', property: 'power'}, // via custom
	'CONSUMPTION': 		{serviceType: 'consumption', property: 'consumption'}, // via custom
	'ACTIVE': 		{serviceType: 'status_active', property: 'status_active'},
	'PRESSURE': 		{serviceType: 'pressure', property: 'pressure'},
	'SHOCK':		{serviceType: 'generic', property: 'state'},
	'RAIN_CURRENT':		{serviceType: 'generic', property: 'state'},
	'RAIN_TOTAL':		{serviceType: 'generic', property: 'state'},
	'WIND_SPEED':		{serviceType: 'generic', property: 'state'},
	'WIND_DIRECTION':	{serviceType: 'generic', property: 'state'},
	'GENERIC_INFO':		{serviceType: 'generic', property: 'state'},
};

module.exports.createClient = function(url, apikey, Plateform,myPlugin) {
	return new JeedomClient(url, apikey, Plateform,myPlugin);
};
