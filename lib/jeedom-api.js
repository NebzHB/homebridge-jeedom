//Jeedom rest api client

'use strict';

var request = require('request');
//request.debug = true;

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
			//that.log(JSON.stringify(response).replace('\n',''));
			if (!err && response.statusCode == 200) {
				that._cachedModel=json.result;
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
		var eqLogic = that._cachedModel.eqLogics[e];
		if(eqLogic.id == ID)
			return eqLogic;
	}
	return null;
};

JeedomClient.prototype.getDeviceCmd = function(ID) {
	var that = this;
	var clist = [];
	for (var c in that._cachedModel.cmds) {
		var cmd = that._cachedModel.cmds[c];
		if(cmd.eqLogic_id == ID)
			clist.push(cmd);
	}
	return clist;
};

JeedomClient.prototype.updateModelInfo = function(ID,value) {
	var that = this;
	for (var c in that._cachedModel.cmds) {
		var cmd = that._cachedModel.cmds[c];
		if(cmd.id == ID && cmd.type=='info') {
			var eq = that.getDeviceProperties(cmd.eqLogic_id)
			that.log('info','[[Modify Model '+eq.name+' > '+cmd.name+'('+cmd.generic_type+') from '+cmd.currentValue+' to '+value+' in ' + JSON.stringify(cmd).replace('\n',''));
			cmd.currentValue=value;
			return cmd;
		} else if (cmd.id == ID) {
			var eq = that.getDeviceProperties(cmd.eqLogic_id)
			that.log('info','Not an INFO ('+cmd.type+')'+eq.name+' > '+cmd.name+'('+cmd.generic_type+') '+value+' in ' + JSON.stringify(cmd).replace('\n',''));
			return null;
		}
	}
	that.log('info','Not found in model '+cmd.id);
	return null;
};

JeedomClient.prototype.ParseGenericType = function(EqLogic, cmds) {
	var result = {};
	var result_cmd = {};
	result.result = [];
	result_cmd.id = EqLogic.id;
	result_cmd.name = EqLogic.name;
	result_cmd.object_id = EqLogic.object_id;
	result_cmd.IsVisible = EqLogic.isVisible;
	var j = 0;
	for (var i in cmds) {
		if (isset(cmds[i].generic_type)) {
			if (cmds[i].generic_type !== null) {
				switch(cmds[i].generic_type) {
				/***************** LIGHT ***********************/
				case 'LIGHT_STATE' :
					if (result_cmd.light == undefined) {
						result_cmd.light = [];
					}
					if (result_cmd.light[i] == undefined) {
						result_cmd.light[i] = {};
					}
					result_cmd.light[i].state = cmds[i];
					break;
				case 'LIGHT_ON' :
					if (result_cmd.light == undefined) {
						result_cmd.light = [];
					}
					if (result_cmd.light[i] == undefined) {
						result_cmd.light[i] = {};
					}
					result_cmd.light[i].on = cmds[i];
					break;
				case 'LIGHT_OFF' :
					if (result_cmd.light == undefined) {
						result_cmd.light = [];
					}
					if (result_cmd.light[i] == undefined) {
						result_cmd.light[i] = {};
					}
					result_cmd.light[i].off = cmds[i];
					break;
				case 'LIGHT_SLIDER' :
					if (result_cmd.light == undefined) {
						result_cmd.light = [];
					}
					if (result_cmd.light[i] == undefined) {
						result_cmd.light[i] = {};
					}
					result_cmd.light[i].slider = cmds[i];
					break;
				case 'LIGHT_COLOR' :
					if (result_cmd.light == undefined) {
						result_cmd.light = [];
					}
					if (result_cmd.light[i] == undefined) {
						result_cmd.light[i] = {};
					}
					result_cmd.light[i].color = cmds[i];
					break;

				/***************** ENERGY ***********************/
				case 'ENERGY_STATE' :
					if (result_cmd.energy == undefined) {
						result_cmd.energy = [];
					}
					if (result_cmd.energy[i] == undefined) {
						result_cmd.energy[i] = {};
					}
					result_cmd.energy[i].state = cmds[i];
					break;
				case 'ENERGY_ON' :
					if (result_cmd.energy == undefined) {
						result_cmd.energy = [];
					}
					if (result_cmd.energy[i] == undefined) {
						result_cmd.energy[i] = {};
					}
					result_cmd.energy[i].on = cmds[i];
					break;
				case 'ENERGY_OFF' :
					if (result_cmd.energy == undefined) {
						result_cmd.energy = [];
					}
					if (result_cmd.energy[i] == undefined) {
						result_cmd.energy[i] = {};
					}
					result_cmd.energy[i].off = cmds[i];
					break;
				case 'ENERGY_SLIDER' :
					if (result_cmd.energy == undefined) {
						result_cmd.energy = [];
					}
					if (result_cmd.energy[i] == undefined) {
						result_cmd.energy[i] = {};
					}
					result_cmd.energy[i].slider = cmds[i];
					break;
				/***************** BARRIER/GARAGE**************/
				case "BARRIER_STATE" :
				case "GARAGE_STATE" :
					if (result_cmd.GarageDoor == undefined) {
						result_cmd.GarageDoor = [];
					}
					if (result_cmd.GarageDoor[i] == undefined) {
						result_cmd.GarageDoor[i] = {};
					}
					result_cmd.GarageDoor[i].state = cmds[i];
					break;
				case "GB_OPEN" :
					if (result_cmd.GarageDoor == undefined) {
						result_cmd.GarageDoor = [];
					}
					if (result_cmd.GarageDoor[i] == undefined) {
						result_cmd.GarageDoor[i] = {};
					}
					result_cmd.GarageDoor[i].on = cmds[i];
					break;
				case "GB_CLOSE" :
					if (result_cmd.GarageDoor == undefined) {
						result_cmd.GarageDoor = [];
					}
					if (result_cmd.GarageDoor[i] == undefined) {
						result_cmd.GarageDoor[i] = {};
					}
					result_cmd.GarageDoor[i].off = cmds[i];
					break;
				/***************** LOCK ***********************/
				case 'LOCK_STATE' :
					if (result_cmd.lock == undefined) {
						result_cmd.lock = [];
					}
					if (result_cmd.lock[i] == undefined) {
						result_cmd.lock[i] = {};
					}
					result_cmd.lock[i].state = cmds[i];
					break;
				case 'LOCK_OPEN' :
					if (result_cmd.lock == undefined) {
						result_cmd.lock = [];
					}
					if (result_cmd.lock[i] == undefined) {
						result_cmd.lock[i] = {};
					}
					result_cmd.lock[i].on = cmds[i];
					break;
				case 'LOCK_CLOSE' :
					if (result_cmd.lock == undefined) {
						result_cmd.lock = [];
					}
					if (result_cmd.lock[i] == undefined) {
						result_cmd.lock[i] = {};
					}
					result_cmd.lock[i].off = cmds[i];
					break;
				/***************** FLAP ***********************/
				case 'FLAP_STATE' :
					if (result_cmd.flap == undefined) {
						result_cmd.flap = [];
					}
					if (result_cmd.flap[i] == undefined) {
						result_cmd.flap[i] = {};
					}
					result_cmd.flap[i].state = cmds[i];
					break;
				case 'FLAP_UP' :
					if (result_cmd.flap == undefined) {
						result_cmd.flap = [];
					}
					if (result_cmd.flap[i] == undefined) {
						result_cmd.flap[i] = {};
					}
					result_cmd.flap[i].up = cmds[i];
					break;
				case 'FLAP_DOWN' :
					if (result_cmd.flap == undefined) {
						result_cmd.flap = [];
					}
					if (result_cmd.flap[i] == undefined) {
						result_cmd.flap[i] = {};
					}
					result_cmd.flap[i].down = cmds[i];
					break;
				case 'FLAP_SLIDER' :
					if (result_cmd.flap == undefined) {
						result_cmd.flap = [];
					}
					if (result_cmd.flap[i] == undefined) {
						result_cmd.flap[i] = {};
					}
					result_cmd.flap[i].slider = cmds[i];
					break;
				case 'FLAP_STOP' :
					if (result_cmd.flap == undefined) {
						result_cmd.flap = [];
					}
					if (result_cmd.flap[i] == undefined) {
						result_cmd.flap[i] = {};
					}
					result_cmd.flap[i].stop = cmds[i];
					break;
				/*************** THERMOSTAT ***********************/
				case 'THERMOSTAT_STATE' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.state = cmds[i];
					break;
				case 'THERMOSTAT_STATE_NAME' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.state_name = cmds[i];
					break;
				case 'THERMOSTAT_TEMPERATURE' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.temperature = cmds[i];
					break;
				case 'THERMOSTAT_SET_SETPOINT' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.set_setpoint = cmds[i];
					break;
				case 'THERMOSTAT_SETPOINT' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.setpoint = cmds[i];
					break;
				case 'THERMOSTAT_SET_MODE' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.set_mode = cmds[i];
					break;
				case 'THERMOSTAT_MODE' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.mode = cmds[i];
					break;
				case 'THERMOSTAT_LOCK' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.lock = cmds[i];
					break;
				case 'THERMOSTAT_SET_LOCK' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.set_lock = cmds[i];
					break;
				case 'THERMOSTAT_TEMPERATURE_OUTDOOR' :
					if (result_cmd.thermostat == undefined) {
						result_cmd.thermostat = {};
					}
					result_cmd.thermostat.temperature_outdoor = cmds[i];
					break;
				/*************** ALARME ***********************/
				case 'ALARM_STATE' :
					if (result_cmd.alarm == undefined) {
						result_cmd.alarm = {};
					}
					result_cmd.alarm.state = cmds[i];
					break;
				case 'ALARM_MODE' :
					if (result_cmd.alarm == undefined) {
						result_cmd.alarm = {};
					}
					result_cmd.alarm.mode = cmds[i];
					break;
				case 'ALARM_ENABLE_STATE' :
					if (result_cmd.alarm == undefined) {
						result_cmd.alarm = {};
					}
					result_cmd.alarm.enable_state = cmds[i];
					break;
				case 'ALARM_ARMED' :
					if (result_cmd.alarm == undefined) {
						result_cmd.alarm = {};
					}
					result_cmd.alarm.armed = cmds[i];
					break;
				case 'ALARM_RELEASED' :
					if (result_cmd.alarm == undefined) {
						result_cmd.alarm = {};
					}
					result_cmd.alarm.released = cmds[i];
					break;
				case 'ALARM_SET_MODE' :
					if (result_cmd.alarm == undefined) {
						result_cmd.alarm = {};
					}
					result_cmd.alarm.set_mode = cmds[i];
					break;
				/***************** GENERIC ***********************/
				case 'OPENING_WINDOW' :
				case 'OPENING' :
					if (result_cmd.opening == undefined) {
						result_cmd.opening = [];
					}
					if (result_cmd.opening[i] == undefined) {
						result_cmd.opening[i] = {};
					}
					result_cmd.opening[i].opening = cmds[i];
					break;
				/*case 'OPENING_WINDOW' :
					if (result_cmd.openwindow == undefined) {
						result_cmd.openwindow = [];
					}
					if (result_cmd.openwindow[i] == undefined) {
						result_cmd.openwindow[i] = {};
					}
					result_cmd.openwindow[i].openwindow = cmds[i];
					break;*/
				case 'BATTERY' :
					if (result_cmd.battery == undefined) {
						result_cmd.battery = [];
					}
					if (result_cmd.battery[i] == undefined) {
						result_cmd.battery[i] = {};
					}
					result_cmd.battery[i].battery = cmds[i];
					break;
				case 'PRESENCE' :
					if (result_cmd.presence == undefined) {
						result_cmd.presence = [];
					}
					if (result_cmd.presence[i] == undefined) {
						result_cmd.presence[i] = {};
					}
					result_cmd.presence[i].presence = cmds[i];
					break;
				case 'TEMPERATURE' :
					if (cmds[i].currentValue !== '' || cmds[i].currentValue > '-50') {
						if (result_cmd.temperature == undefined) {
							result_cmd.temperature = [];
						}
						if (result_cmd.temperature[i] == undefined) {
							result_cmd.temperature[i] = {};
						}
						result_cmd.temperature[i].temperature = cmds[i];
					}
					break;
				case 'BRIGHTNESS' :
					if (result_cmd.brightness == undefined) {
						result_cmd.brightness = [];
					}
					if (result_cmd.brightness[i] == undefined) {
						result_cmd.brightness[i] = {};
					}
					result_cmd.brightness[i].brightness = cmds[i];
					break;
				case 'SECURITY_STATE' :
					if (result_cmd.security_state == undefined) {
						result_cmd.security_state = [];
					}
					if (result_cmd.security_state[i] == undefined) {
						result_cmd.security_state[i] = {};
					}
					result_cmd.security_state[i].security_state = cmds[i];
					break;
				case 'SMOKE' :
					if (result_cmd.smoke == undefined) {
						result_cmd.smoke = [];
					}
					if (result_cmd.smoke[i] == undefined) {
						result_cmd.smoke[i] = {};
					}
					result_cmd.smoke[i].smoke = cmds[i];
					break;
				case 'UV' :
					if (result_cmd.uv == undefined) {
						result_cmd.uv = [];
					}
					if (result_cmd.uv[i] == undefined) {
						result_cmd.uv[i] = {};
					}
					result_cmd.uv[i].uv = cmds[i];
					break;
				case 'HUMIDITY' :
					if (result_cmd.humidity == undefined) {
						result_cmd.humidity = [];
					}
					if (result_cmd.humidity[i] == undefined) {
						result_cmd.humidity[i] = {};
					}
					result_cmd.humidity[i].humidity = cmds[i];
					break;
				case 'SABOTAGE' :
					if (result_cmd.sabotage == undefined) {
						result_cmd.sabotage = [];
					}
					if (result_cmd.sabotage[i] == undefined) {
						result_cmd.sabotage[i] = {};
					}
					result_cmd.sabotage[i].sabotage = cmds[i];
					break;
				case 'FLOOD' :
					if (result_cmd.flood == undefined) {
						result_cmd.flood = [];
					}
					if (result_cmd.flood[i] == undefined) {
						result_cmd.flood[i] = {};
					}
					result_cmd.flood[i].flood = cmds[i];
					break;
				case 'POWER' :
					if (result_cmd.power == undefined) {
						result_cmd.power = [];
					}
					if (result_cmd.power[i] == undefined) {
						result_cmd.power[i] = {};
					}
					result_cmd.power[i].power = cmds[i];
					break;
				case 'CONSUMPTION' :
					if (result_cmd.consumption == undefined) {
						result_cmd.consumption = [];
					}
					if (result_cmd.consumption[i] == undefined) {
						result_cmd.consumption[i] = {};
					}
					result_cmd.consumption[i].consumption = cmds[i];
					break;
				}
			}
		}
	}
	result.result[j] = {};
	//console.log('RESULT CMD > '+JSON.stringify(result_cmd));
	if (isset(result_cmd.light)) {
		if (isset(result_cmd.light.state) && isset(result_cmd.light.on) && isset(result_cmd.light.off)) {
			if (isset(result_cmd.light.color)) {
				result.result[j].type = 'LIGHTRGB';
				j++;
			} else {
				result.result[j].type = 'LIGHT';
				j++;
			}
		}
	} else if (isset(result_cmd.energy)) {
		if (isset(result_cmd.energy.state) && isset(result_cmd.energy.on) && isset(result_cmd.energy.off)) {
			result.result[j].type = 'ENERGY';
			j++;
		}
	} else if (isset(result_cmd.GarageDoor)) {
		if (isset(result_cmd.GarageDoor.state) && isset(result_cmd.GarageDoor.on) && isset(result_cmd.GarageDoor.off)) {
			result.result[j].type = 'GARAGEDOOR';
			j++;
		}
	} else if (isset(result_cmd.lock)) {
		if (isset(result_cmd.lock.state) && isset(result_cmd.lock.on) && isset(result_cmd.lock.off)) {
			result.result[j].type = 'LOCK';
			j++;
		}
	} else if (result_cmd.flap != undefined) {
		if (result_cmd.flap.state != undefined && result_cmd.flap.up != undefined && result_cmd.flap.down != undefined) {
			result.result[j].type = 'FLAP';

			j++;
		}
	} else if (isset(result_cmd.thermostat)) {
		if (isset(result_cmd.thermostat.state) && isset(result_cmd.thermostat.temperature) && isset(result_cmd.thermostat.setpoint)) {
			result.result[j].type = 'THERMOSTAT';
			j++;
		}
	} else if (isset(result_cmd.opening) || isset(result_cmd.openwindow)) {
		result.result[j].type = 'OPENING';
		if (isset(result_cmd.opening)) {
			result.result[j].cmds = result_cmd.opening;
			j++;
		} else {
			result.result[j].cmds = result_cmd.openwindow;
			j++;
		}
	} else {
		if (isset(result_cmd.presence)) {
			result.result[j] = {};
			result.result[j].type = 'PRESENCE';
			result.result[j].cmds = result_cmd.presence;
			j++;
		}
		if (isset(result_cmd.smoke)) {
			result.result[j] = {};
			result.result[j].type = 'SMOKE';
			result.result[j].cmds = result_cmd.smoke;
			j++;
		}
		if (result_cmd.temperature != undefined) {
			result.result[j] = {};
			result.result[j].type = 'TEMPERATURE';
			result.result[j].cmds = result_cmd.temperature;
			j++;
		}
		if (isset(result_cmd.brightness)) {
			result.result[j] = {};
			result.result[j].type = 'BRIGHTNESS';
			result.result[j].cmds = result_cmd.brightness;
			j++;
		}
		if (isset(result_cmd.humidity)) {
			result.result[j] = {};
			result.result[j].type = 'HUMIDITY';
			result.result[j].cmds = result_cmd.humidity;
			j++;
		}
	}
	result.result_cmd = [];
	result.result_cmd = result_cmd;
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
