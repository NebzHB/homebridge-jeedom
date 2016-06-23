//Jeedom rest api client

'use strict';

var request = require("request");

function JeedomClient(ip, port, complement, apikey) {
	this.apikey = apikey;
	this.url = "http://"+ip+":"+port+""+complement+"/core/api/jeeApi.php";
}
JeedomClient.prototype.getRooms = function() {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"object::all","params":{"apikey":"'+that.apikey+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200)
        		resolve(json);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.getDevices = function() {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"eqLogic::all","params":{"apikey":"'+that.apikey+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.getDeviceProperties = function(ID) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	    var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"eqLogic::byId","params":{"apikey":"'+that.apikey+'","id":"'+ID+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json.properties);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.getDeviceCmd = function(ID) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	    var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"cmd::byEqLogicId","params":{"apikey":"'+that.apikey+'","id":"'+ID+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json.properties);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.executeDeviceAction = function(ID, action, param) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
		var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"cmd::execCmd","params":{"apikey":"'+that.apikey+'","id":"'+ID+'"}}'
		  }
		}, function(err, response) {
      		if (!err && (response.statusCode == 200 || response.statusCode == 202)) 
        		resolve(response);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.refreshStates = function(lastPoll) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"event::changes","params":{"apikey":"'+that.apikey+'","datetime" : "'+lastPoll+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json);
        	else
        		reject(err, response);
        });
	});
	return p;
}

module.exports.createClient = function(ip, port, complement, apikey) {
	return new JeedomClient(ip, port, complement, apikey);
}

function ParseGenericType(EqLogic,Cmds){
	var result = {html : null};
	result.eqLogic = {};
	result.id = EqLogic.id;
	result.name = EqLogic.name;
	result.ObjectId = EqLogic.object_id;
	result.IsVisible = EqLogic.isVisible;
	for (var i in cmds) {
		switch(cmds[i].display.generic_type){
			/***************** LIGHT ***********************/
            case 'LIGHT_STATE' :
                if(result.light == undefined){
                    result.light = {};
                }
                result.light.state = cmds[i];
            break;
            case 'LIGHT_ON' :
                if(result.light == undefined){
                    result.light = {};
                }
                result.light.on = cmds[i];
            break;
            case 'LIGHT_OFF' :
                if(result.light == undefined){
                    result.light = {};
                }
                result.light.off = cmds[i];
            break;
            case 'LIGHT_COLOR' :
                if(result.light == undefined){
                    result.light = {};
                }
                result.light.color = cmds[i];
            break;
				
		/***************** ENERGY ***********************/
            case 'ENERGY_STATE' :
                if(result.energy == undefined){
                    result.energy = {};
                }
                result.energy.state = cmds[i];
            break;
            case 'ENERGY_ON' :
                if(result.energy == undefined){
                    result.energy = {};
                }
                result.energy.on = cmds[i];
            break;
            case 'ENERGY_OFF' :
                if(result.energy == undefined){
                    result.energy = {};
                }
                result.energy.off = cmds[i];
            break;
            case 'ENERGY_SLIDER' :
                if(result.energy == undefined){
                    result.energy = {};
                }
                result.energy.slider = cmds[i];
            break;
            /***************** LOCK ***********************/
            case 'LOCK_STATE' :
                if(result.lock == undefined){
                    result.lock = {};
                }
                result.lock.state = cmds[i];
            break;
            case 'LOCK_OPEN' :
                if(result.lock == undefined){
                    result.lock = {};
                }
                result.lock.on = cmds[i];
            break;
            case 'LOCK_CLOSE' :
                if(result.lock == undefined){
                    result.lock = {};
                }
                result.lock.off = cmds[i];
            break;
            /***************** FLAP ***********************/
            case 'FLAP_STATE' :
                if(result.flap == undefined){
                    result.flap = {};
                }
                result.flap.state = cmds[i];
            break;
            case 'FLAP_UP' :
                if(result.flap == undefined){
                    result.flap = {};
                }
                result.flap.up = cmds[i];
            break;
            case 'FLAP_DOWN' :
                if(result.flap == undefined){
                    result.flap = {};
                }
                result.flap.down = cmds[i];
            break;
            case 'FLAP_SLIDER' :
                if(result.flap == undefined){
                    result.flap = {};
                }
                result.flap.slider = cmds[i];
            break;
            case 'FLAP_STOP' :
                if(result.flap == undefined){
                    result.flap = {};
                }
                result.flap.stop = cmds[i];
            break;
            /*************** THERMOSTAT ***********************/
            case 'THERMOSTAT_STATE' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.state = cmds[i];
            break;
            case 'THERMOSTAT_STATE_NAME' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.state_name = cmds[i];
            break;
            case 'THERMOSTAT_TEMPERATURE' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.temperature = cmds[i];
            break;
            case 'THERMOSTAT_SET_SETPOINT' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.set_setpoint = cmds[i];
            break;
            case 'THERMOSTAT_SETPOINT' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.setpoint = cmds[i];
            break;
            case 'THERMOSTAT_SET_MODE' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.set_mode = cmds[i];
            break;
            case 'THERMOSTAT_MODE' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.mode = cmds[i];
            break;
            case 'THERMOSTAT_LOCK' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.lock = cmds[i];
            break;
            case 'THERMOSTAT_SET_LOCK' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.set_lock = cmds[i];
            break;
            case 'THERMOSTAT_TEMPERATURE_OUTDOOR' :
               if(result.thermostat == undefined){
                   result.thermostat = {};
               }
               result.thermostat.temperature_outdoor = cmds[i];
            break;
            /***************** GENERIC ***********************/
            case 'OPENING' :
                result.opening = cmds[i];
                break;
            case 'OPENING_WINDOW' :
                result.openwindow = cmds[i];
                break;
            case 'BATTERY' :
                result.battery = cmds[i];
                break;
            case 'PRESENCE' :
                result.presence = cmds[i];
                break;
            case 'TEMPERATURE' :
                if(cmds[i].currentValue !== '' || cmds[i].currentValue > '-50'){
                result.temperature = cmds[i];
                }
                break;
            case 'BRIGHTNESS' :
                result.brightness = cmds[i];
                break;
            case 'SECURITY_STATE' :
                result.security_state = cmds[i];
                break;
            case 'SMOKE' :
                result.smoke = cmds[i];
                break;
            case 'UV' :
                result.uv = cmds[i];
                break;
            case 'HUMIDITY' : 
                result.humidity = cmds[i];
                break;
            case 'SABOTAGE' :
                result.sabotage = cmds[i];
                break;
            case 'FLOOD' :
                result.flood = cmds[i];
                break;
            case 'POWER' :
                result.power = cmds[i];
                break;
            case 'CONSUMPTION' :
                result.consumption = cmds[i];
                break;
		}
	}
	if(result.light != undefined){
		if(result.light.state != undefined && result.light.on != undefined && result.light.off != undefined){
			if(result.light.color != undefined){
				result.type = 'LIGHTRGB';
			}else{
				result.type = 'LIGHT';
			}
		}
	}else if(result.energy != undefined){
		if(result.energy.state != undefined && result.energy.on != undefined && result.energy.off != undefined){
			result.type = 'ENERGY';
		}
	}else if(result.lock != undefined){
		if(result.lock.state != undefined && result.lock.on != undefined && result.lock.off != undefined){
			result.type = 'LOCK';
		}
	}else if(result.flap != undefined){
		if(result.flap.state != undefined && result.flap.up != undefined && result.flap.down != undefined){
			result.type = 'FLAP';
		}
	}else if(result.thermostat != undefined){
		if(result.thermostat.state != undefined && result.thermostat.temperature != undefined && result.thermostat.setpoint != undefined){
			result.type = 'THERMOSTAT';
		}
	}else if(result.opening != undefined || result.openwindow != undefined){
			result.type = 'OPENING';
	}else if(result.presence != undefined){
		result.type = 'PRESENCE';
	}else if(result.smoke != undefined){
		result.type = 'SMOKE';
	}else if(result.temperature != undefined){
		result.type = "TEMPERATURE";
	}else if(result.brightness != undefined){
		result.type = "BRIGHTNESS";
	}else if(result.humidity != undefined){
		result.type = "HUMIDITY";
	}else{
		result.type = null;
	}
	return result;
}
