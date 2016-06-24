//Jeedom rest api client

'use strict';

var request = require("request");

function JeedomClient(ip, port, complement, apikey) {
	this.apikey = apikey;
	this.url = "http://"+ip+":"+port+"/core/api/jeeApi.php";
}
JeedomClient.prototype.getRooms = function() {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
		console.log(url);
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"object::all","params":{"apikey":"'+that.apikey+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200)
        		resolve(json.result);
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
        		resolve(json.result);
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
      		if (!err && response.statusCode == 200){ 
				resolve(json.result);
        	}else{
        		reject(err, response);
		}
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
		    request: '{"jsonrpc":"2.0","method":"cmd::byEqLogicId","params":{"apikey":"'+that.apikey+'","eqLogic_id":"'+ID+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200){ 
				resolve(json.result);
        	}else{
        		reject(err, response);
        }});
	});
	return p;
}
JeedomClient.prototype.ParseGenericType = function(EqLogic,cmds){
	var result = {};
	var result_cmd = {};
	result.id = EqLogic.id;
	result.name = EqLogic.name;
	result.object_id = EqLogic.object_id;
	result.IsVisible = EqLogic.isVisible;
	result.type = null;
	result.result = [];
	var j = 0;
	for (var i in cmds) {
		if(isset(cmds[i].generic_type)){
		if(cmds[i].generic_type !== null){
		switch(cmds[i].generic_type){
			/***************** LIGHT ***********************/
            case 'LIGHT_STATE' :
                if(result_cmd.light == undefined){
                    result_cmd.light = {};
                }
                result_cmd.light.state = cmds[i];
            break;
            case 'LIGHT_ON' :
                if(result_cmd.light == undefined){
                    result_cmd.light = {};
                }
                result_cmd.light.on = cmds[i];
            break;
            case 'LIGHT_OFF' :
                if(result_cmd.light == undefined){
                    result_cmd.light = {};
                }
                result_cmd.light.off = cmds[i];
            break;
            case 'LIGHT_COLOR' :
                if(result_cmd.light == undefined){
                    result_cmd.light = {};
                }
                result_cmd.light.color = cmds[i];
            break;
				
		/***************** ENERGY ***********************/
            case 'ENERGY_STATE' :
                if(result_cmd.energy == undefined){
                    result_cmd.energy = {};
                }
                result_cmd.energy.state = cmds[i];
            break;
            case 'ENERGY_ON' :
                if(result_cmd.energy == undefined){
                    result_cmd.energy = {};
                }
                result_cmd.energy.on = cmds[i];
            break;
            case 'ENERGY_OFF' :
                if(result_cmd.energy == undefined){
                    result_cmd.energy = {};
                }
                result_cmd.energy.off = cmds[i];
            break;
            case 'ENERGY_SLIDER' :
                if(result_cmd.energy == undefined){
                    result_cmd.energy = {};
                }
                result_cmd.energy.slider = cmds[i];
            break;
            /***************** LOCK ***********************/
            case 'LOCK_STATE' :
                if(result_cmd.lock == undefined){
                    result_cmd.lock = {};
                }
                result_cmd.lock.state = cmds[i];
            break;
            case 'LOCK_OPEN' :
                if(result_cmd.lock == undefined){
                    result_cmd.lock = {};
                }
                result_cmd.lock.on = cmds[i];
            break;
            case 'LOCK_CLOSE' :
                if(result_cmd.lock == undefined){
                    result_cmd.lock = {};
                }
                result_cmd.lock.off = cmds[i];
            break;
            /***************** FLAP ***********************/
            case 'FLAP_STATE' :
                if(result_cmd.flap == undefined){
                    result_cmd.flap = {};
                }
                result_cmd.flap.state = cmds[i];
            break;
            case 'FLAP_UP' :
                if(result_cmd.flap == undefined){
                    result_cmd.flap = {};
                }
                result_cmd.flap.up = cmds[i];
            break;
            case 'FLAP_DOWN' :
                if(result_cmd.flap == undefined){
                    result_cmd.flap = {};
                }
                result_cmd.flap.down = cmds[i];
            break;
            case 'FLAP_SLIDER' :
                if(result_cmd.flap == undefined){
                    result_cmd.flap = {};
                }
                result_cmd.flap.slider = cmds[i];
            break;
            case 'FLAP_STOP' :
                if(result_cmd.flap == undefined){
                    result_cmd.flap = {};
                }
                result_cmd.flap.stop = cmds[i];
            break;
            /*************** THERMOSTAT ***********************/
            case 'THERMOSTAT_STATE' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.state = cmds[i];
            break;
            case 'THERMOSTAT_STATE_NAME' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.state_name = cmds[i];
            break;
            case 'THERMOSTAT_TEMPERATURE' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.temperature = cmds[i];
            break;
            case 'THERMOSTAT_SET_SETPOINT' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.set_setpoint = cmds[i];
            break;
            case 'THERMOSTAT_SETPOINT' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.setpoint = cmds[i];
            break;
            case 'THERMOSTAT_SET_MODE' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.set_mode = cmds[i];
            break;
            case 'THERMOSTAT_MODE' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.mode = cmds[i];
            break;
            case 'THERMOSTAT_LOCK' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.lock = cmds[i];
            break;
            case 'THERMOSTAT_SET_LOCK' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.set_lock = cmds[i];
            break;
            case 'THERMOSTAT_TEMPERATURE_OUTDOOR' :
               if(result_cmd.thermostat == undefined){
                   result_cmd.thermostat = {};
               }
               result_cmd.thermostat.temperature_outdoor = cmds[i];
            break;
            /***************** GENERIC ***********************/
            case 'OPENING' :
                result_cmd.opening = cmds[i];
                break;
            case 'OPENING_WINDOW' :
                result_cmd.openwindow = cmds[i];
                break;
            case 'BATTERY' :
                result_cmd.battery = cmds[i];
                break;
            case 'PRESENCE' :
                result_cmd.presence = cmds[i];
                break;
            case 'TEMPERATURE' :
                if(cmds[i].currentValue !== '' || cmds[i].currentValue > '-50'){
                result_cmd.temperature = cmds[i];
                }
                break;
            case 'BRIGHTNESS' :
                result_cmd.brightness = cmds[i];
                break;
            case 'SECURITY_STATE' :
                result_cmd.security_state = cmds[i];
                break;
            case 'SMOKE' :
                result_cmd.smoke = cmds[i];
                break;
            case 'UV' :
                result_cmd.uv = cmds[i];
                break;
            case 'HUMIDITY' : 
                result_cmd.humidity = cmds[i];
                break;
            case 'SABOTAGE' :
                result_cmd.sabotage = cmds[i];
                break;
            case 'FLOOD' :
                result_cmd.flood = cmds[i];
                break;
            case 'POWER' :
                result_cmd.power = cmds[i];
                break;
            case 'CONSUMPTION' :
                result_cmd.consumption = cmds[i];
                break;
		}
		}
		}
	}
	if(isset(result_cmd.light)){
		if(isset(result_cmd.light.state) && isset(result_cmd.light.on) && isset(result_cmd.light.off)){
			if(isset(result_cmd.light.color)){
				result.result[j].type = 'LIGHTRGB';
				j++;
			}else{
				result.result[j].type = 'LIGHT';
				j++;
			}
		}
	}else if(isset(result_cmd.energy)){
		if(isset(result_cmd.energy.state) && isset(result_cmd.energy.on) && isset(result_cmd.energy.off)){
			result.result[j].type = 'ENERGY';
			j++;
		}
	}else if(isset(result_cmd.lock)){
		if(isset(result_cmd.lock.state) && isset(result_cmd.lock.on) && isset(result_cmd.lock.off)){
			result.result[j].type = 'LOCK';
			j++;
		}
	}else if(isset(result_cmd.flap)){
		if(isset(result_cmd.flap.state) && isset(result_cmd.flap.up) && isset(result_cmd.flap.down)){
			result.result[j].type = 'FLAP';
			j++;
		}
	}else if(isset(result_cmd.thermostat)){
		if(isset(result_cmd.thermostat.state) && risset(esult_cmd.thermostat.temperature) && isset(result_cmd.thermostat.setpoint)){
			result.result[j].type = 'THERMOSTAT';
			j++;
		}
	}else if(isset(result_cmd.opening) || isset(result_cmd.openwindow)){
			result.result[j].type = 'OPENING';
			if(isset(result_cmd.opening)){
			result.result[j].cmds = result_cmd.opening;
			j++;
			}else{
			result.result[j].cmds = result_cmd.openwindow;
			j++;
			}
	}else{
		if(isset(result_cmd.presence)){
			result.result[j].type = 'PRESENCE';
			result.result[j].cmds = result_cmd.presence;
			j++;
		}
		if(isset(result_cmd.smoke)){
			result.result[j].type = 'SMOKE';
			result.result[j].cmds = result_cmd.smoke;
			j++;
		}
		if(isset(result_cmd.temperature)){
			result.result[j].type = "TEMPERATURE";
			result.result[j].cmds = result_cmd.temperature;
			j++;
		}
		if(isset(result_cmd.brightness)){
			result.result[j].type = "BRIGHTNESS";
			result.result[j].cmds = result_cmd.brightness;
			j++;
		}
		if(isset(result_cmd.humidity)){
			result.result[j].type = "HUMIDITY";
			result.result[j].cmds = result_cmd.humidity;
			j++;
		}
	}
	return result;
}
JeedomClient.prototype.executeDeviceAction = function(ID, action, param) {
	var that = this;
	var options = "";
	console.log('params : '+param);
	if(param != null){
		options = ',"options":{"slider":'+param+'}';
	};
	var p = new Promise(function(resolve, reject) {
		var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"cmd::execCmd","params":{"apikey":"'+that.apikey+'","id":"'+ID+'"'+options+'}}'
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

function isset ()
{
  var a = arguments,
    l = a.length,
    i = 0,
    undef;

  if (l === 0)
  {
    throw new Error('Empty isset');
  }

  while (i !== l)
  {
    if (a[i] === undef || a[i] === null)
    {
      return false;
    }
    i++;
  }
  return true;
}

module.exports.createClient = function(ip, port, complement, apikey) {
	return new JeedomClient(ip, port, complement, apikey);
}