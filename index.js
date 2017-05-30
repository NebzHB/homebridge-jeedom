// Jeedom Platform plugin for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//             "platform": "Jeedom",
//             "url": "PUT URL OF YOUR JEEDOM HERE",
//             "apikey": "PUT APIKEY OF YOUR JEEDOM HERE",
//             "grouping": "PUT none OR room",
//             "pollerperiod": "PUT 0 FOR DISABLING POLLING, 1 - 100 INTERVAL IN SECONDS. 2 SECONDS IS THE DEFAULT",
//			   "debugLevel": "PUT DEBUG LEVEL : debug, info, warn, error, "
//     }
// ],
//
// When you attempt to add a device, it will ask for a "PIN code".
// The default code for all HomeBridge accessories is 031-45-154.

'use strict';

var Accessory, Service, Characteristic, UUIDGen;
//var http = require('http');
var inherits = require('util').inherits;
var debug = {};
debug.DEBUG = 100;
debug.INFO = 200;
debug.WARN = 300;
debug.ERROR = 400;
debug.NO = 1000;

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;
	RegisterCustomCharacteristics();
	homebridge.registerPlatform('homebridge-jeedom', 'Jeedom', JeedomPlatform, true);
};
var myLogger=require('./lib/myLogger').myLogger;
function JeedomPlatform(logger, config, api) {
	try{
		this.config = config || {};
		this.api = api;
		this.accessories = [];
		this.debugLevel = config['debugLevel'] || debug.ERROR;
		this.log = myLogger.createMyLogger(this.debugLevel,logger);
		this.log('debugLevel:'+this.debugLevel);
		
		config['url'] = 'http://127.0.0.1:80'; 
		/*if (config["url"] == "undefined" || config["url"] == "http://:80") {
			this.log("Adresse Jeedom non configurée, Veuillez la configurer avant de relancer.");
		}else{
			this.log("Adresse Jeedom bien configurée :"+config["url"]);	
		}*/
		this.jeedomClient = require('./lib/jeedom-api').createClient(config['url'], config['apikey'], this);
		this.rooms = {};
		this.updateSubscriptions = [];
		this.simplifiedUUID = true; // the accessories keep his UUID if the room is changed or if it's renamed
		
		this.lastPoll = 0;
		this.pollingUpdateRunning = false;
		this.pollingID = null;
		
		this.pollerPeriod = config['pollerperiod'];
		if ( typeof this.pollerPeriod == 'string')
			this.pollerPeriod = parseInt(this.pollerPeriod);
		else if (this.pollerPeriod == undefined)
			this.pollerPeriod = 0.5; // 0.5 is Nice between 2 calls
		this.pollerPeriod = 0.5; // FORCE 0.5

		if (api) {
			// Save the API object as plugin needs to register new accessory via this object.
			this.api = api;

			// Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories
			// Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
			// Or start discover new accessories
			this.api.on('didFinishLaunching',function(){
				this.addAccessories();
			}.bind(this));
		}
	}
	catch (e) {
		this.log('error','Erreur de la Fonction JeedomPlatform : '+e);	
	}
}

JeedomPlatform.prototype.addAccessories = function() {
	try{
		var that = this;
		that.log('Synchronisation Jeedom <> Homebridge...');
		that.jeedomClient.getModel()
			.then(function(model){ // we got the base Model from the API
				that.lastPoll=model.config.datetime;
				that.log('Enumération des objets Jeedom (Pièces)...');
				model.objects.map(function(r, i, a){
					that.rooms[r.id] = r.name;
					that.log('Pièce > ' + r.name);
				});
			
				that.log('Enumération des périphériques Jeedom...');
				if(model.eqLogics == null) that.log('error','Périf > '+model.eqLogics);
				that.JeedomDevices2HomeKitAccessories(model.eqLogics);
			}).catch(function(err, response) {
				that.log('error','#2 Erreur de récupération des données Jeedom: ' + err + ' (' + response + ')');
			});
	}
	catch(e){
		this.log('error','Erreur de la fonction addAccessories :'+e);
	}
};
JeedomPlatform.prototype.JeedomDevices2HomeKitAccessories = function(devices) {
	try{
		var that = this;
		if (devices != undefined) {
			devices.sort(function compare(a, b) {
				// reorder by room name asc and name asc
				var aC = that.rooms[a.object_id]+a.name;
				var bC = that.rooms[b.object_id]+b.name;
				if (aC > bC) {
					return 1;
				}
				if (aC < bC) {
					return -1;
				}
				return 0;
			});
			var currentRoomID = '';
			var services = [];
			var service = null;
			
			devices.map(function(device) {
				//that.log('debug',device);
				var goesToHomebridge = (device.isVisible == '1' && device.object_id != null && device.sendToHomebridge != '0'); // we dont receive not visible and empty room, so the only test here is sendToHomebridge
				if (goesToHomebridge) { 

					var resultEqL = that.jeedomClient.getDeviceProperties(device.id);
					var resultCMD = that.jeedomClient.getDeviceCmd(device.id);
					
					AccessoireCreateJeedom(that.jeedomClient.ParseGenericType(resultEqL, resultCMD));
					
					function AccessoireCreateJeedom(_params) {
						
						var cmds = _params;
						that.log('debug','PARAMS > '+JSON.stringify(_params).replace("\n",''));
						that.log('┌──── ' + that.rooms[_params.object_id] + ' > ' + _params.name + ' (' + _params.id + ')');
						if (cmds.light) {
							var cmds2 = cmds;
							cmds.light.forEach(function(cmd, index, array) {
								if (cmd.color) {
									service = {
										controlService : new Service.Lightbulb(_params.name),
										characteristics : [Characteristic.On, Characteristic.Brightness, Characteristic.Hue, Characteristic.Saturation]
									};
									service.controlService.cmd_id = cmd.color.id;
									service.controlService.HSBValue = {
										hue : 0,
										saturation : 0,
										brightness : 0
									};
									service.controlService.RGBValue = {
										red : 0,
										green : 0,
										blue : 0
									};
									service.controlService.countColorCharacteristics = 0;
									service.controlService.timeoutIdColorCharacteristics = 0;
									service.controlService.subtype = 'RGB';
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.color.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								} else if (cmd.state) {
									var cmd_on = 0;
									var cmd_off = 0;
									var cmd_slider = 0;
									cmds2.light.forEach(function(cmd2, index2, array2) {
										if (cmd2.on) {
											if (cmd2.on.value == cmd.state.id) {
												cmd_on = cmd2.on.id;
											}
										} else if (cmd2.off) {
											if (cmd2.off.value == cmd.state.id) {
												cmd_off = cmd2.off.id;
											}
										} else if (cmd2.slider) {
											if (cmd2.slider.value == cmd.state.id) {
												cmd_slider = cmd2.slider.id;
											}
										}
									});
									if (cmd_slider == 0) {
										service = {
											controlService : new Service.Lightbulb(_params.name),
											characteristics : [Characteristic.On]
										};
									} else {
										service = {
											controlService : new Service.Lightbulb(_params.name),
											characteristics : [Characteristic.On, Characteristic.Brightness]
										};
									}
									service.controlService.cmd_id = cmds.light.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.state.id + '|' + cmd_on + '|' + cmd_off + '|' + cmd_slider + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.flap) {
							var cmds2 = cmds;
							cmds.flap.forEach(function(cmd, index, array) {
								if (cmd.state) {
									var cmd_up = 0;
									var cmd_down = 0;
									var cmd_slider = 0;
									var cmd_stop = 0;
									cmds2.flap.forEach(function(cmd2, index2, array2) {
										if (cmd2.up) {
											if (cmd2.up.value == cmd.state.id) {
												cmd_up = cmd2.up.id;
											}
										} else if (cmd2.down) {
											if (cmd2.down.value == cmd.state.id) {
												cmd_down = cmd2.down.id;
											}
										} else if (cmd2.slider) {
											if (cmd2.slider.value == cmd.state.id) {
												cmd_slider = cmd2.slider.id;
											}
										}
									});
									service = {
										controlService : new Service.WindowCovering(_params.name),
										characteristics : [Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState]
									};
									service.controlService.cmd_id = cmd.state.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.state.id + '|' + cmd_down + '|' + cmd_up + '|' + cmd_slider + '-' + service.controlService.subtype;

									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.energy) {
							var cmds2 = cmds;
							cmds.energy.forEach(function(cmd, index, array) {
								if (cmd.state) {
									var cmd_on = 0;
									var cmd_off = 0;
									cmds2.energy.forEach(function(cmd2, index2, array2) {
										if (cmd2.on) {
											if (cmd2.on.value == cmd.state.id) {
												cmd_on = cmd2.on.id;
											}
										} else if (cmd2.off) {
											if (cmd2.off.value == cmd.state.id) {
												cmd_off = cmd2.off.id;
											}
										}
									});
									service = {
										controlService : new Service.Switch(_params.name),
										characteristics : [Characteristic.On]
									};
									service.controlService.cmd_id = cmd.state.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.state.id + '|' + cmd_on + '|' + cmd_off + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.power || cmds.consumption) {
							cmds.power.forEach(function(cmd, index, array) {
								if (cmd.power || cmd.consumption) {
									service = {
										controlService : new Service.PowerMonitor(_params.name),
										characteristics : [Characteristic.CurrentPowerConsumption, Characteristic.TotalPowerConsumption]
									};
									if (cmd.power) {
										var cmd_id = cmd.power.id;
									} else {
										var cmd_id = cmd.consumption.id;
									}

									service.controlService.cmd_id = cmd_id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd_id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});

						}
						if (cmds.battery) {
							cmds.battery.forEach(function(cmd, index, array) {
								if (cmd.battery) {
									service = {
										controlService : new Service.BatteryService(_params.name),
										characteristics : [Characteristic.BatteryLevel]
									};
									service.controlService.cmd_id = cmd.battery.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.battery.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.presence) {
							cmds.presence.forEach(function(cmd, index, array) {
								if (cmd.presence) {
									service = {
										controlService : new Service.MotionSensor(_params.name),
										characteristics : [Characteristic.MotionDetected]
									};
									service.controlService.cmd_id = cmd.presence.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.presence.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.temperature) {
							cmds.temperature.forEach(function(cmd, index, array) {
								if (cmd.temperature) {
									service = {
										controlService : new Service.TemperatureSensor(_params.name),
										characteristics : [Characteristic.CurrentTemperature]
									};
									service.controlService.cmd_id = cmd.temperature.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.temperature.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});

						}
						if (cmds.humidity) {
							cmds.humidity.forEach(function(cmd, index, array) {
								if (cmd.humidity) {
									service = {
										controlService : new Service.HumiditySensor(_params.name),
										characteristics : [Characteristic.CurrentRelativeHumidity]
									};
									service.controlService.cmd_id = cmd.humidity.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.humidity.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.smoke) {
							cmds.smoke.forEach(function(cmd, index, array) {
								if (cmd.smoke) {
									service = {
										controlService : new Service.SmokeSensor(_params.name),
										characteristics : [Characteristic.SmokeDetected]
									};
									service.controlService.cmd_id = cmd.smoke.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.smoke.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.flood) {
							cmds.flood.forEach(function(cmd, index, array) {
								if (cmd.flood) {
									service = {
										controlService : new Service.LeakSensor(_params.name),
										characteristics : [Characteristic.LeakDetected]
									};
									service.controlService.cmd_id = cmd.flood.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.flood.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.opening) {
							cmds.opening.forEach(function(cmd, index, array) {
								if (cmd.opening) {
									service = {
										controlService : new Service.ContactSensor(_params.name),
										characteristics : [Characteristic.ContactSensorState]
									};
									service.controlService.cmd_id = cmd.opening.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.opening.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.brightness) {
							cmds.brightness.forEach(function(cmd, index, array) {
								if (cmd.brightness) {
									service = {
										controlService : new Service.LightSensor(_params.name),
										characteristics : [Characteristic.CurrentAmbientLightLevel]
									};
									service.controlService.cmd_id = cmd.brightness.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.brightness.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.energy2) {
							service = {
								controlService : new Service.Outlet(_params.name),
								characteristics : [Characteristic.On, Characteristic.OutletInUse]
							};
							if (service.controlService.subtype == undefined)
								service.controlService.subtype = '';
							service.controlService.subtype = _params.id + '-' + cmds.brightness.id + '-' + service.controlService.subtype;
							services.push(service);
							service = null;
						}
						if (cmds.GarageDoor) {
							var cmds2 = cmds;
							cmds.GarageDoor.forEach(function(cmd, index, array) {
								if (cmd.state) {
									var cmd_on = 0;
									var cmd_off = 0;
									var cmd_toggle = 0;
									cmds2.GarageDoor.forEach(function(cmd2, index2, array2) {
										if (cmd2.on) {
											if (cmd2.on.value == cmd.state.id) {
												cmd_on = cmd2.on.id;
											}
										} else if (cmd2.off) {
											if (cmd2.off.value == cmd.state.id) {
												cmd_off = cmd2.off.id;
											}
										} else if (cmd2.toggle) {
											if (cmd2.toggle.value == cmd.state.id) {
												cmd_toggle = cmd2.toggle.id;
											}
										}
									});
									service = {
										controlService : new Service.GarageDoorOpener(_params.name),
										characteristics : [Characteristic.CurrentDoorState, Characteristic.TargetDoorState]//, Characteristic.ObstructionDetected]
									};
									service.controlService.cmd_id = cmd.state.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.state.id + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.lock) {
							var cmds2 = cmds;
							cmds.lock.forEach(function(cmd, index, array) {
								if (cmd.state) {
									var cmd_on = 0;
									var cmd_off = 0;
									cmds2.lock.forEach(function(cmd2, index2, array2) {
										if (cmd2.on) {
											if (cmd2.on.value == cmd.state.id) {
												cmd_on = cmd2.on.id;
											}
										} else if (cmd2.off) {
											if (cmd2.off.value == cmd.state.id) {
												cmd_off = cmd2.off.id;
											}
										}
									});
									service = {
										controlService : new Service.LockMechanism(_params.name),
										characteristics : [Characteristic.LockCurrentState, Characteristic.LockTargetState]
									};
									service.controlService.cmd_id = cmd.state.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = '';
									service.controlService.subtype = _params.id + '-' + cmd.state.id + '|' + cmd_on + '|' + cmd_off + '-' + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							});
						}
						if (cmds.thermostat) {
							service = {
								controlService : new Service.Thermostat(_params.name),
								characteristics : [Characteristic.CurrentTemperature, Characteristic.TargetTemperature, Characteristic.CurrentHeatingCoolingState, Characteristic.TargetHeatingCoolingState]
							};
							service.controlService.cmd_id = cmds.thermostat.id;
							if (service.controlService.subtype == undefined)
								service.controlService.subtype = '';
							service.controlService.subtype = _params.id + '-' + cmds.thermostat.id + '-' + service.controlService.subtype;
							services.push(service);
							service = null;
						}
						if (cmds.alarm) {
							service = {
								controlService : new Service.SecuritySystem(_params.name),
								characteristics : [Characteristic.SecuritySystemCurrentState, Characteristic.SecuritySystemTargetState]
							};
							service.controlService.cmd_id = cmds.alarm.id;
							if (service.controlService.subtype == undefined)
								service.controlService.subtype = '';
							service.controlService.subtype = _params.id + '-' + cmds.alarm.enable_state.id + '-' + cmds.alarm.state.id;
							services.push(service);
							service = null;
						}
						if (services.length != 0) {
							for (let s=0;s<services.length;s++) {
								that.log('info','Services :'+services[s].controlService.displayName,'subtype:'+services[s].controlService.subtype,'cmd_id:'+services[s].controlService.cmd_id,'UUID:'+services[s].controlService.UUID);
								for (let c=0;c<services[s].controlService.characteristics.length;c++) {
									that.log('info','Characteristics :'+services[s].controlService.characteristics[c].displayName,'value:'+services[s].controlService.characteristics[c].value);
								}
							}
							that.addAccessory(
								that.createAccessory(services, device.id, device.name, device.object_id, device.eqType_name,device.logicalId)
							);
							services = [];
						}
						else
						{
							that.log('│ Accessoire sans Type Générique');
							that.delAccessory(
								that.createAccessory([], device.id, device.name, device.object_id, device.eqType_name, device.logicalId) // create a cached lookalike object for unregistering it
							);
						}
						that.log('└─────────');
					}
				}
				else
				{
					that.log('┌──── ' + that.rooms[device.object_id] + ' > ' +device.name+' ('+device.id+')');
					var Messg= '│ Accessoire ';
					Messg   += device.isVisible == '1' ? 'visible' : 'invisible';
					Messg   += device.object_id != null ? '' : ', pas dans une pièce';
					Messg   += device.sendToHomebridge != '0' ? '' : ', pas coché pour Homebridge';
					that.log(Messg);

					that.delAccessory(
						that.createAccessory([], device.id, device.name, device.object_id, device.eqType_name, device.logicalId) // create a cached lookalike object for unregistering it
					);
					that.log('└─────────');
				}
				
			});
		}
		
		that.log('┌────RAMASSE-MIETTES─────');
		that.log('│ (Suppression des accessoires qui sont dans le cache mais plus dans jeedom (peut provenir de renommage ou changement de pièce))');
		var hasDeleted = false
		var countA=0;
		for (var a in that.accessories) 
		{
			if(!that.accessories[a].reviewed && that.accessories[a].displayName)
			{
				that.log('│ ┌──── Trouvé: '+that.accessories[a].displayName);
				that.delAccessory(that.accessories[a],true);
				that.log('│ │ Supprimé du cache !');
				that.log('│ └─────────');
				hasDeleted=true;
			}else if(that.accessories[a].reviewed && that.accessories[a].displayName) countA++;
		}
		if(!hasDeleted) that.log('│ Rien à supprimer');
		that.log('└────────────────────────');
		
		var endLog = '--== Homebridge est démarré et a intégré '+countA+' accessoire'+ (countA>1 ? 's' : '') +' ! (Si vous avez un Warning Avahi, ne pas en tenir compte) ==--';
		that.log(endLog);
		if(countA >= 95) that.log('warn','!!! ATTENTION !!! Vous avez '+countA+' accessoires et HomeKit en supporte 100 max !!');
		else if(countA >= 85) that.log('warn','! Avertissement, vous avez '+countA+' accessoires et HomeKit en supporte 100 max !!');
		
		if (that.pollerPeriod <= 100)
			that.startPollingUpdate();
	}
	catch(e){
		this.log('error','Erreur de la fonction JeedomDevices2HomeKitAccessories :'+e);
	}
};
JeedomPlatform.prototype.createAccessory = function(services, id, name, currentRoomID, eqType_name, logicalId) {
	try{
		var accessory = new JeedomBridgedAccessory(services);
		accessory.platform = this;
		accessory.name = (name) ? name : this.rooms[currentRoomID] + '-Devices';
		if (this.simplifiedUUID) accessory.UUID = UUIDGen.generate(id + accessory.name);
		else accessory.UUID = UUIDGen.generate(id + accessory.name + currentRoomID);
		accessory.context = {};
		if (this.simplifiedUUID) accessory.context.uniqueSeed = id + accessory.name;
		else accessory.context.uniqueSeed = id + accessory.name + currentRoomID;
		accessory.model = eqType_name;
		accessory.manufacturer = 'Jeedom > '+ this.rooms[currentRoomID] +' > '+name;
		accessory.serialNumber = '<'+id+'-'+logicalId+'>';
		accessory.services_add = services;
		return accessory;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction createAccessory :'+e);
	}
};
JeedomPlatform.prototype.delAccessory = function(jeedomAccessory,silence) {
	try{
		silence = typeof silence  !== 'undefined' ? silence : false;
		if (!jeedomAccessory) {
			return;
		}

		if(!silence) this.log('│ Vérification d\'existance de l\'accessoire dans Homebridge...');
		var existingAccessory = this.existingAccessory(jeedomAccessory.UUID,silence);
		if(existingAccessory)
		{
			if(!silence) this.log('│ Suppression de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [existingAccessory]);
			delete this.accessories[jeedomAccessory.UUID];
			existingAccessory.reviewed=true;
		}
		else
		{
			if(!silence) this.log('│ Accessoire Ignoré');
		}
	}
	catch(e){
		this.log('error','│ Erreur de la fonction delAccessory :'+e);
	}
};
JeedomPlatform.prototype.addAccessory = function(jeedomAccessory) {
	try{
		if (!jeedomAccessory) {
			return;
		}
		var isNewAccessory = false;
		var uniqueSeed = jeedomAccessory.UUID;
		var services = jeedomAccessory.services_add;
		this.log('│ Vérification d\'existance de l\'accessoire dans Homebridge...');
		var newAccessory = this.existingAccessory(uniqueSeed);
		if (!newAccessory) {
			this.log('│ Nouvel accessoire (' + jeedomAccessory.name + ')');
			isNewAccessory = true;
			var newAccessory = new Accessory(jeedomAccessory.name, jeedomAccessory.UUID);
			jeedomAccessory.initAccessory(newAccessory);
			this.accessories[jeedomAccessory.UUID] = jeedomAccessory;
		}
		newAccessory.reachable = true;


		// Remove services existing in HomeKit accessory no more present in Jeedom
		for (var t = 0; t < newAccessory.services.length; t++) {
			var found = false;
			for (var s = 0; s < services.length; s++) {
				if (newAccessory.services[t].displayName == undefined || services[s].controlService.displayName == newAccessory.services[t].displayName) {
					found = true;
					break;	  		
				}
			}
			if (!found) {
				newAccessory.removeService(newAccessory.services[t]);
				this.log('│ Supression des service (' + jeedomAccessory.name + '/' + newAccessory.services[t].displayName + ')');
			}
		}

		
		
		if (isNewAccessory) {
			this.log('│ Ajout de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.registerPlatformAccessories('homebridge-jeedom', 'Jeedom', [newAccessory]);
		}else{
			this.log('│ Mise à jour de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.updatePlatformAccessories([newAccessory]);
		}
		newAccessory.reviewed = true;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction addAccessory :'+e);
	}
};

JeedomPlatform.prototype.existingAccessory = function(uniqueSeed,silence) {
	try{
		silence = typeof silence  !== 'undefined' ? silence : false;
		for (var a in this.accessories) {
			if (this.accessories[a].UUID == uniqueSeed) {
				if(!silence) this.log('│ Accessoire déjà existant dans Homebridge');
				return this.accessories[a];
			}
		}
		if(!silence) this.log('│ Accessoire non existant dans Homebridge');
		return null;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction existingAccessory :'+e);	
	}
};


JeedomPlatform.prototype.configureAccessory = function(accessory) {
	try{
		for (var s = 0; s < accessory.services.length; s++) {
			var service = accessory.services[s];
			if (service.subtype != undefined) {
				var subtypeParams = service.subtype.split('-');
				if (subtypeParams.length == 3 && subtypeParams[2] == 'RGB') {
					service.HSBValue = {
						hue : 0,
						saturation : 0,
						brightness : 0
					};
					service.RGBValue = {
						red : 0,
						green : 0,
						blue : 0
					};
					service.countColorCharacteristics = 0;
					service.timeoutIdColorCharacteristics = 0;
				}
			}
			for (var i = 0; i < service.characteristics.length; i++) {
				var characteristic = service.characteristics[i];
				if (characteristic.props.needsBinding)
					this.bindCharacteristicEvents(characteristic, service);
			}
		}
		this.log('Accessoire en cache: ' + accessory.displayName);
		this.accessories[accessory.UUID] = accessory;
		accessory.reachable = true;
	}
	catch(e){
		this.log('error','Erreur de la fonction configureAccessory :'+e);
	}
};
JeedomPlatform.prototype.bindCharacteristicEvents = function(characteristic, service) {
	try{
		var onOff = characteristic.props.format == 'bool' ? true : false;
		var readOnly = true;
		for (var i = 0; i < characteristic.props.perms.length; i++)
			if (characteristic.props.perms[i] == 'pw')
				readOnly = false;
		var IDs = service.subtype.split('-');
		var propertyChanged = 'value';
		if (service.HSBValue != undefined)
			propertyChanged = 'color';
		this.subscribeUpdate(service, characteristic, onOff, propertyChanged);
		if (!readOnly) {
			characteristic.on('set', function(value, callback, context) {
				if (characteristic.UUID == '00000033-0000-1000-8000-0026BB765291') {
					this.log('set target mode');
				}
				if (context !== 'fromJeedom' && context !== 'fromSetValue') { // from Homekit
					this.log('info','[Commande d\'Homekit] value:'+value,'context:'+JSON.stringify(context),'characteristic:'+JSON.stringify(characteristic));
				
					if (characteristic.UUID == (new Characteristic.On()).UUID && service.isVirtual) {
						this.command('pressButton', IDs[1], service, IDs);
						setTimeout(function() {
							characteristic.setValue(false, undefined, 'fromSetValue');
						}, 100);
					} else if (characteristic.UUID == (new Characteristic.On()).UUID) {
						this.command(value == 0 ? 'turnOff' : 'turnOn', null, service, IDs);
					} else if (characteristic.UUID == (new Characteristic.TargetTemperature()).UUID) {
						if (Math.abs(value - characteristic.value) >= 0.5) {
							value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
							this.command('setTargetLevel', value, service, IDs);
						} else {
							value = characteristic.value;
						}
						setTimeout(function() {
							characteristic.setValue(value, undefined, 'fromSetValue');
						}, 100);
					} else if (characteristic.UUID == (new Characteristic.TimeInterval()).UUID) {
						this.command('setTime', value + Math.trunc((new Date()).getTime() / 1000), service, IDs);
					} else if (characteristic.UUID == (new Characteristic.TargetHeatingCoolingState()).UUID) {
						this.command('TargetHeatingCoolingState', value, service, IDs);
					} else if (characteristic.UUID == (new Characteristic.TargetDoorState()).UUID) {
						var action = 'GBtoggle';//value == Characteristic.TargetDoorState.OPEN ? 'GBopen' : 'GBclose';
						this.command(action, 0, service, IDs);
					} else if (characteristic.UUID == (new Characteristic.LockTargetState()).UUID) {
						var action = value == Characteristic.LockTargetState.UNSECURED ? 'unsecure' : 'secure';
						this.command(action, 0, service, IDs);
					} else if (characteristic.UUID == (new Characteristic.Hue()).UUID) {
						var rgb = this.updateJeedomColorFromHomeKit(value, null, null, service);
						this.syncColorCharacteristics(rgb, service, IDs);
					} else if (characteristic.UUID == (new Characteristic.Saturation()).UUID) {
						var rgb = this.updateJeedomColorFromHomeKit(null, value, null, service);
						this.syncColorCharacteristics(rgb, service, IDs);
					} else if (characteristic.UUID == (new Characteristic.Brightness()).UUID) {
						if (service.HSBValue != null) {
							var rgb = this.updateJeedomColorFromHomeKit(null, null, value, service);
							this.syncColorCharacteristics(rgb, service, IDs);
						} else {
							this.command('setValue', value, service, IDs);
						}
					} else {
						this.command('setValue', value, service, IDs);
					}
				}
				else
					this.log('info','[Commande de Jeedom] value:'+value,'context:'+JSON.stringify(context),'characteristic:'+JSON.stringify(characteristic));
				callback();
			}.bind(this));
		}
		characteristic.on('get', function(callback) {
			this.log('info','[Demande d\'Homekit] IDs:'+IDs,'onOff:'+onOff,'service:'+JSON.stringify(service),'characteristic:'+JSON.stringify(characteristic));
		//	if (service.isVirtual) {
		//		callback(undefined, false);
		//	} else {
				this.getAccessoryValue(callback, onOff, characteristic, service, IDs);
		//	}
		}.bind(this));
	}
	catch(e){
		this.log('error','Erreur de la fonction bindCharacteristicEvents :'+e);
	}
};
JeedomPlatform.prototype.getAccessoryValue = function(callback, returnBoolean, characteristic, service, IDs) {
	try{
		var that = this;
		var cmds = IDs[1].split('|');
		var properties = that.jeedomClient.getDeviceCmd(IDs[0]);
			if (characteristic.UUID == (new Characteristic.OutletInUse()).UUID) {
				callback(undefined, parseFloat(properties.power) > 1.0 ? true : false);
			} else if (characteristic.UUID == (new Characteristic.TimeInterval()).UUID) {
				var t = (new Date()).getTime();
				t = parseInt(properties.timestamp) - t;
				if (t < 0)
					t = 0;
				callback(undefined, t);
			} else if (characteristic.UUID == (new Characteristic.TargetTemperature()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'THERMOSTAT_SETPOINT') {
						v = parseInt(element.currentValue);
						//console.log("valeur " + element.generic_type + " : " + v);
					}
				});
				callback(undefined, v);
			} else if (characteristic.UUID == (new Characteristic.Hue()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'LIGHT_COLOR') {
						//console.log("valeur " + element.generic_type + " : " + v);
						v = element.currentValue;
					}
				});
				var hsv = that.updateHomeKitColorFromJeedom(v, service);
				callback(undefined, Math.round(hsv.h));
			} else if (characteristic.UUID == (new Characteristic.Saturation()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'LIGHT_COLOR') {
						//console.log("valeur " + element.generic_type + " : " + v);
						v = element.currentValue;
					}
				});
				var hsv = that.updateHomeKitColorFromJeedom(v, service);
				callback(undefined, Math.round(hsv.s));
			} else if (characteristic.UUID == (new Characteristic.SmokeDetected()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'SMOKE' && element.id == cmds[0]) {
						v = parseInt(element.currentValue);
						//console.log("valeur " + element.generic_type + " : " + v);
					}
				});
				callback(undefined, v == 1 ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
			} else if (characteristic.UUID == (new Characteristic.LeakDetected()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'FLOOD' && element.id == cmds[0]) {
						v = parseInt(element.currentValue);
						//console.log("valeur " + element.generic_type + " : " + v);
					}
				});
				callback(undefined, v == 1 ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED);
			} else if (characteristic.UUID == (new Characteristic.ContactSensorState()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'OPENING' && element.id == cmds[0]) {
						v = parseInt(element.currentValue);
						//console.log("valeur " + element.generic_type + " : " + v);
					}
				});
				callback(undefined, v == 1 ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
			} else if (characteristic.UUID == (new Characteristic.Brightness()).UUID) {
				if (service.HSBValue != null) {
					var v = '';
					properties.forEach(function(element, index, array) {
						if (element.generic_type == 'LIGHT_COLOR') {
							//console.log("valeur " + element.generic_type + " : " + v);
							v = element.currentValue;
						}
					});
					var hsv = that.updateHomeKitColorFromJeedom(v, service);
					callback(undefined, Math.round(hsv.v));
				} else {
					var v = '';
					properties.forEach(function(element, index, array) {
						if (element.generic_type == 'LIGHT_STATE' && element.id == cmds[0]) {
							if (v == '')
								v = 0;
							// v = parseInt(element.currentValue);
							v = Math.round(parseInt(element.currentValue) * 100/99); // brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to %
							//console.log("valeur " + element.generic_type + " : " + v);
						}
					});
					callback(undefined, v);
				}
			} else if (characteristic.UUID == (new Characteristic.SecuritySystemCurrentState()).UUID) {
				var v = 0;
				var alarm = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'ALARM_ENABLE_STATE') {
						if (parseInt(element.currentValue) == 0) {
							//console.log("valeur " + element.generic_type + " : desarmé");
							v = Characteristic.SecuritySystemCurrentState.DISARMED;
						} else {
							//console.log("valeur " + element.generic_type + " : armé");
							v = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
						}
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					}
					if (element.generic_type == 'ALARM_STATE') {
						if (parseInt(element.currentValue) == 1) {
							//console.log("valeur " + element.generic_type + " : alarm");
							alarm = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
						}
					}
				});
				if (alarm != 0) {
					callback(undefined, alarm);
				} else {
					callback(undefined, v);
				}

			} else if (characteristic.UUID == (new Characteristic.SecuritySystemTargetState()).UUID) {
				var v = 0;
				var alarm = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'ALARM_ENABLE_STATE') {
						if (parseInt(element.currentValue) == 0) {
							//console.log("valeur " + element.generic_type + " : desarmé");
							v = Characteristic.SecuritySystemCurrentState.DISARMED;
						} else {
							//console.log("valeur " + element.generic_type + " : armé");
							v = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
						}
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					}
					if (element.generic_type == 'ALARM_STATE') {
						if (parseInt(element.currentValue) == 1) {
							//console.log("valeur " + element.generic_type + " : alarm");
							alarm = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
						}
					}
				});
				if (alarm != 0) {
					callback(undefined, alarm);
				} else {
					callback(undefined, v);
				}

			} else if (characteristic.UUID == (new Characteristic.CurrentHeatingCoolingState()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'THERMOSTAT_MODE') {
						if (element.currentValue == 'Off') {
							v = Characteristic.CurrentHeatingCoolingState.OFF;
						} else {
							v = Characteristic.CurrentHeatingCoolingState.AUTO;
						}
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					}
				});
				callback(undefined, v);
			} else if (characteristic.UUID == (new Characteristic.PositionState()).UUID) {
				callback(undefined, Characteristic.PositionState.STOPPED);
			} else if (characteristic.UUID == (new Characteristic.LockCurrentState()).UUID || characteristic.UUID == (new Characteristic.LockTargetState()).UUID) {
				callback(undefined, properties.value == 'true' ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED);
			} else if (characteristic.UUID == (new Characteristic.CurrentDoorState()).UUID || characteristic.UUID == (new Characteristic.TargetDoorState()).UUID) {
				that.log('debug','properties: '+JSON.stringify(properties));
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'GARAGE_STATE' || element.generic_type == 'BARRIER_STATE') {
						var v=null;
						switch(parseInt(element.currentValue)) {
								case 255 :
										v=Characteristic.CurrentDoorState.OPEN; //0
								break;
								case 0 :
										v=Characteristic.CurrentDoorState.CLOSED; // 1
								break;
								case 254 :
										v=Characteristic.CurrentDoorState.OPENING; // 2
								break;
								case 252 :
										v=Characteristic.CurrentDoorState.CLOSING; // 3
								break;
								case 253 :
										v=Characteristic.CurrentDoorState.STOPPED; // 4
								break;
						}
						that.log('debug','GetState Homekit: '+v+' soit en Jeedom:'+element.currentValue);
						callback(undefined, v);
					}
				});
						
			} else if (characteristic.UUID == (new Characteristic.CurrentPosition()).UUID || characteristic.UUID == (new Characteristic.TargetPosition()).UUID) {
				var v = '';
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'FLAP_STATE' && element.id == cmds[0]) {
						v = parseInt(element.currentValue);
						//console.log("valeur " + element.generic_type + " : " + v);
					}
				});
				callback(undefined, v);
			} else if (returnBoolean) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if ((element.generic_type == 'LIGHT_STATE' && element.id == cmds[0]) || (element.generic_type == 'ENERGY_STATE' && element.id == cmds[0]) || (element.generic_type == 'PRESENCE' && element.id == cmds[0]) || (element.generic_type == 'OPENING' && element.id == cmds[0])) {
						v = element.currentValue;
						//console.log("valeur binary " + element.generic_type + " : " + v);
					}
				});

				//var v = properties.value;
				if (v == 'true' || v == 'false') {
					callback(undefined, (v == 'false') ? false : true);
				} else {
					callback(undefined, (parseInt(v) == 0) ? false : true);
				}
			} else if (characteristic.UUID == (new Characteristic.CurrentTemperature()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if ((element.generic_type == 'TEMPERATURE' && element.id == cmds[0]) || element.generic_type == 'THERMOSTAT_TEMPERATURE') {
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
						v = element.currentValue;
					}
				});
				callback(undefined, parseFloat(v));
			} else if (characteristic.UUID == (new Characteristic.CurrentAmbientLightLevel()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'BRIGHTNESS' && element.id == cmds[0]) {
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
						v = element.currentValue;
					}
				});
				callback(undefined, parseInt(v));
			} else if (characteristic.UUID == (new Characteristic.CurrentRelativeHumidity()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'HUMIDITY' && element.id == cmds[0]) {
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
						v = element.currentValue;
					}
				});
				callback(undefined, parseInt(v));
			} else if (characteristic.UUID == (new Characteristic.BatteryLevel()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'BATTERY' && element.id == cmds[0]) {
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
						v = element.currentValue;
					}
				});
				callback(undefined, parseInt(v));
			} else if (characteristic.UUID == (new Characteristic.CurrentPowerConsumption()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'POWER' && element.id == cmds[0]) {
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
						v = element.currentValue;
					}
				});
				callback(undefined, parseFloat(v));
			} else if (characteristic.UUID == (new Characteristic.TotalPowerConsumption()).UUID) {
				var v = 0;
				properties.forEach(function(element, index, array) {
					if (element.generic_type == 'CONSUMPTION' && element.id == cmds[0]) {
						//console.log("valeur " + element.generic_type + " : " + element.currentValue);
						v = element.currentValue;
					}
				});
				callback(undefined, parseFloat(v));
			} else {
				var v = 0;
				callback(undefined, parseInt(v));
			}

	}
	catch(e){
		this.log('error','Erreur de la fonction getAccessoryValue :'+e);
	}
};
JeedomPlatform.prototype.command = function(c, value, service, IDs) {
	try{
		var that = this;
		var cmds = IDs[1].split('|');
		if (service.UUID == (new Service.SecuritySystem()).UUID) {
			c = 'SetAlarmMode';
		} else if (value == 0 && service.UUID == (new Service.WindowCovering).UUID) {
			c = 'flapDown';
		} else if ((value == 99 || value == 100) && service.UUID == (new Service.WindowCovering).UUID) {
			c = 'flapUp';
		}
		var resultCMD = that.jeedomClient.getDeviceCmd(IDs[0]); 
			var cmdId = cmds[0];
			resultCMD.forEach(function(element, index, array) {
				if (c == 'flapDown' && element.generic_type == 'FLAP_DOWN') {
					cmdId = element.id;
				} else if (c == 'flapUp' && element.generic_type == 'FLAP_UP') {
					cmdId = element.id;
				} else if (c == 'GBopen' && element.generic_type == 'GB_OPEN') {
					cmdId = element.id;
				} else if (c == 'GBclose' && element.generic_type == 'GB_CLOSE') {
					cmdId = element.id;
				} else if (c == 'GBtoggle' && element.generic_type == 'GB_TOGGLE') {
					cmdId = element.id;
				} else if (c == 'unsecure' && element.generic_type == 'LOCK_OPEN') {
					cmdId = element.id;
				} else if (c == 'secure' && element.generic_type == 'LOCK_CLOSE') {
					cmdId = element.id;
				} else if (value >= 0 && element.id == cmds[3] && (element.generic_type == 'LIGHT_SLIDER' || element.generic_type == 'FLAP_SLIDER')) {
					cmdId = element.id;
					if (value == undefined) {
						if (c == 'turnOn') {
							value = 99;
						} else if (c == 'turnOff') {
							value = 0;
						}
					} else {
						// brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to Zwave
						value =	Math.round(value * 99/100);
					}
				} else if ((value == 255 || c == 'turnOn') && element.id == cmds[1] && (element.generic_type == 'LIGHT_ON' || element.generic_type == 'ENERGY_ON')) {
					cmdId = element.id;
				} else if ((value == 0 || c == 'turnOff') && element.id == cmds[2] && (element.generic_type == 'LIGHT_OFF' || (element.generic_type == 'ENERGY_OFF' && element.id == cmds[2]) )) {
					cmdId = element.id;
				} else if (c == 'setRGB' && element.generic_type == 'LIGHT_SET_COLOR') {
					cmdId = element.id;
				} else if (c == 'SetAlarmMode' && element.generic_type == 'ALARM_ARMED' && value < 3) {
					cmdId = element.id;
				} else if (c == 'SetAlarmMode' && element.generic_type == 'ALARM_RELEASED' && value == 3) {
					cmdId = element.id;
				} else if (c == 'setTargetLevel' && value > 0 && element.generic_type == 'THERMOSTAT_SET_SETPOINT') {
					cmdId = element.id;
				} else if (c == 'TargetHeatingCoolingState') {
					if (element.generic_type == 'THERMOSTAT_SET_MODE' && element.name == 'Off') {
						cmdId = element.id;
					}
				}
			});
			that.jeedomClient.executeDeviceAction(cmdId, c, value).then(function(response) {
				that.log('info','[Commande envoyée à Jeedom] cmdId:' + cmdId,'action:' + c,'value: '+value,'response:'+JSON.stringify(response));
			}).catch(function(err, response) {
				that.log('error','Erreur à l\'envoi de la commande ' + c + ' vers ' + IDs[0] + ' | ' + err + ' - ' + response);
			});

	}
	catch(e){
		this.log('error','Erreur de la fonction command :'+e);	
	}
};
JeedomPlatform.prototype.subscribeUpdate = function(service, characteristic, onOff, propertyChanged) {
	try{
		if (characteristic.UUID == (new Characteristic.PositionState()).UUID)
			return;

		var IDs = service.subtype.split('-');
		this.updateSubscriptions.push({
			'id' : IDs[0],
			'service' : service,
			'characteristic' : characteristic,
			'onOff' : onOff,
			'property' : propertyChanged
		});
	}
	catch(e){
		this.log('error','Erreur de la fonction subscribeUpdate :'+e);
	}
};

JeedomPlatform.prototype.startPollingUpdate = function() {
	var that = this;
	if(that.pollingUpdateRunning) {return;}
	that.pollingUpdateRunning = true;
	
	that.jeedomClient.refreshStates().then(function(updates) {
		that.lastPoll = updates.datetime;
		if (updates.result != undefined) {
			updates.result.map(function(update) {
				that.log('debug','Evènement reçu de Jeedom: '+JSON.stringify(update));
				if(update.name == 'eqLogic::update') {
					that.log('debug','[eqLogic::update] (non géré) : '+JSON.stringify(that.jeedomClient.getDeviceProperties(update.option.eqLogic_id)).replace('\n',''));
				}
				else if (update.name == 'cmd::update' && update.option.value != undefined && update.option.cmd_id != undefined) {
					that.log('info','[Maj reçue de Jeedom] commande:'+update.option.cmd_id+' value:'+update.option.value);
					that.jeedomClient.updateModelInfo(update.option.cmd_id,update.option.value); // Update cachedModel
					setTimeout(function(){that.updateSubscribers(update)},500);
				}
				else {
					that.log('debug','[Type inconnu]: '+update.name+' commande: '+update.option.cmd_id+' value:'+update.option.value);
				}
			});
		}
	}).then(function(){
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','==RESTART POLLING==');that.startPollingUpdate() }, that.pollerPeriod * 1000);
	}).catch(function(err, response) {
		that.log('error','Error fetching updates: ', err, response);
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','!!RESTART POLLING AFTER ERROR!!');that.startPollingUpdate() }, that.pollerPeriod * 2 * 1000);
	});
};

JeedomPlatform.prototype.updateSubscribers = function(update) {
	var that = this;

	var FC = update.option.value[0];
	
	if(FC == '#') update.color=update.option.value;	
	
	if (update.color) that.log('debug','---BEFORE corr:'+update.option.value+' ['+update.color+'[[' + JSON.stringify(update).replace('\n',''));
	
	var value = parseInt(update.option.value);
	if (isNaN(value))
		value = (update.option.value === 'true');

	if (update.color) that.log('debug','---AFTER corr:'+value+' ['+update.color+'[[' + JSON.stringify(update).replace('\n',''));
	
	
	if (update.name == 'cmd::update' && update.option.value != undefined && update.option.cmd_id != undefined) {
		//that.log('debug','cmd : '+JSON.stringify(cmd));
		for (var i = 0; i < that.updateSubscriptions.length; i++) {
			var subscription = that.updateSubscriptions[i];
			if (subscription.service.subtype != undefined) {
				var IDs = subscription.service.subtype.split('-');
				var cmds = IDs[1].split('|');
				var cmd_id = cmds[0];
				var cmd2_id = IDs[2];
			}
			if (cmd_id == update.option.cmd_id || cmd2_id == update.option.cmd_id) {
				var powerValue = false;
				var intervalValue = false;
				if (subscription.characteristic.UUID == (new Characteristic.OutletInUse()).UUID)
					powerValue = true;
				if (subscription.characteristic.UUID == (new Characteristic.TimeInterval()).UUID)
					intervalValue = true;
				if (subscription.characteristic.UUID == (new Characteristic.SmokeDetected()).UUID)
					subscription.characteristic.setValue(value == 0 ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED, undefined, 'fromJeedom');
				
				else if (subscription.characteristic.UUID == (new Characteristic.SecuritySystemCurrentState()).UUID) {
					if (cmd2_id == update.option.cmd_id && value == 1) {
						subscription.characteristic.setValue(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED, undefined, 'fromJeedom');
					} 
					else {
						subscription.characteristic.setValue(value == 0 ? Characteristic.SecuritySystemCurrentState.DISARMED : Characteristic.SecuritySystemCurrentState.ARM_AWAY, undefined, 'fromJeedom');
					}
				} 
				else if (subscription.characteristic.UUID == (new Characteristic.SecuritySystemTargetState()).UUID) {
					subscription.characteristic.setValue(value == 0 ? Characteristic.SecuritySystemCurrentState.DISARMED : Characteristic.SecuritySystemCurrentState.ARM_AWAY, undefined, 'fromJeedom');
				} 
				
				else if (subscription.characteristic.UUID == (new Characteristic.LeakDetected()).UUID) {
					subscription.characteristic.setValue(value == 0 ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED, undefined, 'fromJeedom');
				}
				else if (subscription.characteristic.UUID == (new Characteristic.ContactSensorState()).UUID) {
					subscription.characteristic.setValue(value == 0 ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED, undefined, 'fromJeedom');
				}
				else if (subscription.characteristic.UUID == (new Characteristic.CurrentDoorState()).UUID) {
					// c'est pas les currentdoorstate qu'il faut setter mais les Target : open ou close, 
					var v = null;
					
					switch(parseInt(value)) {
						case 255 :
							v=Characteristic.CurrentDoorState.OPEN; // 0
						break;
						case 0 :
							v=Characteristic.CurrentDoorState.CLOSED; // 1
						break;
						case 254 : 
							v=Characteristic.CurrentDoorState.OPENING; // 2
						break;
						case 252 :
							v=Characteristic.CurrentDoorState.CLOSING; // 3
						break;
						case 253 :
							v=Characteristic.CurrentDoorState.STOPPED; // 4
						break;
					}
					that.log('debug',"Transforme la valeur de Jeedom : "+value+" en valeur pour HomeKit : "+v);
					subscription.characteristic.setValue(v, undefined, 'fromJeedom');
				}
				else if (subscription.characteristic.UUID == (new Characteristic.TargetDoorState()).UUID) {
					subscription.characteristic.setValue(!value, undefined, 'fromJeedom');
				}
				else if (subscription.characteristic.UUID == (new Characteristic.LockCurrentState()).UUID || subscription.characteristic.UUID == (new Characteristic.LockTargetState()).UUID) {
					subscription.characteristic.setValue(value == 1 ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED, undefined, 'fromJeedom');
				}
				else if (subscription.characteristic.UUID == (new Characteristic.CurrentPosition()).UUID || subscription.characteristic.UUID == (new Characteristic.TargetPosition()).UUID) {
					if (value >= subscription.characteristic.props.minValue && value <= subscription.characteristic.props.maxValue)
						subscription.characteristic.setValue(value, undefined, 'fromJeedom');
				} 
				else if (update.power != undefined && powerValue) {
					subscription.characteristic.setValue(parseFloat(update.power) > 1.0 ? true : false, undefined, 'fromJeedom');
				} // brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to %    
				else if (subscription.characteristic.UUID == (new Characteristic.Brightness()).UUID) {                
					subscription.characteristic.setValue(Math.round(value * 100/99), undefined, 'fromJeedom');
				} 
				else if ((subscription.onOff && typeof (value) == 'boolean') || !subscription.onOff) {
					subscription.characteristic.setValue(value, undefined, 'fromJeedom');
				} 
				else {
					subscription.characteristic.setValue(value == 0 ? false : true, undefined, 'fromJeedom');
				}
			}
		}
	}
	if (update.color != undefined) {
		that.log('debug','isColor',update.name == 'cmd::update',update.option.value != undefined,update.option.cmd_id != undefined);
		for (var i = 0; i < that.updateSubscriptions.length; i++) {
			var subscription = that.updateSubscriptions[i];
			if (subscription.id == update.id && subscription.property == 'color') {
				var hsv = that.updateHomeKitColorFromJeedom(update.color, subscription.service);
				if (subscription.characteristic.UUID == (new Characteristic.On()).UUID)
					subscription.characteristic.setValue(hsv.v == 0 ? false : true, undefined, 'fromJeedom');
				else if (subscription.characteristic.UUID == (new Characteristic.Hue()).UUID)
					subscription.characteristic.setValue(Math.round(hsv.h), undefined, 'fromJeedom');
				else if (subscription.characteristic.UUID == (new Characteristic.Saturation()).UUID)
					subscription.characteristic.setValue(Math.round(hsv.s), undefined, 'fromJeedom');
				else if (subscription.characteristic.UUID == (new Characteristic.Brightness()).UUID)
					subscription.characteristic.setValue(Math.round(hsv.v), undefined, 'fromJeedom');
			}
		}
	}
};
JeedomPlatform.prototype.updateJeedomColorFromHomeKit = function(h, s, v, service) {
	if (h != null)
		service.HSBValue.hue = h;
	if (s != null)
		service.HSBValue.saturation = s;
	if (v != null)
		service.HSBValue.brightness = v;
	var rgb = HSVtoRGB(service.HSBValue.hue, service.HSBValue.saturation, service.HSBValue.brightness);
	service.RGBValue.red = rgb.r;
	service.RGBValue.green = rgb.g;
	service.RGBValue.blue = rgb.b;
	return rgb;
};
JeedomPlatform.prototype.updateHomeKitColorFromJeedom = function(color, service) {
	if (color == undefined)
		color = '0,0,0';
	//console.log("couleur :" + color);
	var colors = color.split(',');
	var r = hexToR(color);
	var g = hexToG(color);
	var b = hexToB(color);
	service.RGBValue.red = r;
	service.RGBValue.green = g;
	service.RGBValue.blue = b;
	var hsv = RGBtoHSV(r, g, b);
	service.HSBValue.hue = hsv.h;
	service.HSBValue.saturation = hsv.s;
	service.HSBValue.brightness = hsv.v;
	return hsv;
};

JeedomPlatform.prototype.syncColorCharacteristics = function(rgb, service, IDs) {
	switch (--service.countColorCharacteristics) {
	case -1:
		service.countColorCharacteristics = 2;
		var that = this;
		service.timeoutIdColorCharacteristics = setTimeout(function() {
			if (service.countColorCharacteristics < 2)
				return;
			var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
			that.command('setRGB', rgbColor, service, IDs);
			service.countColorCharacteristics = 0;
			service.timeoutIdColorCharacteristics = 0;
		}, 1000);
		break;
	case 0:
		var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
		this.command('setRGB', rgbColor, service, IDs);
		service.countColorCharacteristics = 0;
		service.timeoutIdColorCharacteristics = 0;
		break;
	default:
		break;
	}
};
function RegisterCustomCharacteristics() {
	// Custom Services and Characteristics
	Characteristic.TimeInterval = function() {
		Characteristic.call(this, 'Time Interval', '2A6529B5-5825-4AF3-AD52-20288FBDA115');
		this.setProps({
			format : Characteristic.Formats.FLOAT,
			unit : Characteristic.Units.SECONDS,
			maxValue : 21600, // 12 hours
			minValue : 0,
			minStep : 900, // 15 min
			perms : [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.TimeInterval, Characteristic);
	Characteristic.TimeInterval.UUID = '2A6529B5-5825-4AF3-AD52-20288FBDA115';

	Characteristic.CurrentPowerConsumption = function() {
		Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format : Characteristic.Formats.UINT16,
			unit : 'watts',
			maxValue : 1000000000,
			minValue : 0,
			minStep : 1,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.CurrentPowerConsumption, Characteristic);
	Characteristic.CurrentPowerConsumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

	Characteristic.TotalPowerConsumption = function() {
		Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format : Characteristic.Formats.FLOAT, // Deviation from Eve Energy observed type
			unit : 'kilowatthours',
			maxValue : 1000000000,
			minValue : 0,
			minStep : 0.001,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.TotalPowerConsumption, Characteristic);
	Characteristic.TotalPowerConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

	/**
	 * Custom Service 'Power Monitor'
	 */

	Service.PowerMonitor = function(displayName, subtype) {
		Service.call(this, displayName, '0EB29E08-C307-498E-8E1A-4EDC5FF70607', subtype);

		// Required Characteristics
		this.addCharacteristic(Characteristic.CurrentPowerConsumption);
		this.addCharacteristic(Characteristic.TotalPowerConsumption);

		// Optional Characteristics

	};
	inherits(Service.PowerMonitor, Service);
	Service.PowerMonitor.UUID = '0EB29E08-C307-498E-8E1A-4EDC5FF70607';

	// End of custom Services and Characteristics	
}
function JeedomBridgedAccessory(services) {
	this.services = services;
}

JeedomBridgedAccessory.prototype.initAccessory = function(newAccessory) {
	newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, this.manufacturer).setCharacteristic(Characteristic.Model, this.model).setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

	for (var s = 0; s < this.services.length; s++) {
		var service = this.services[s];
		newAccessory.addService(service.controlService);
		for (var i = 0; i < service.characteristics.length; i++) {
			var characteristic = service.controlService.getCharacteristic(service.characteristics[i]);
			characteristic.props.needsBinding = true;
			if (characteristic.UUID == (new Characteristic.CurrentAmbientLightLevel()).UUID) {
				characteristic.props.maxValue = 1000;
				characteristic.props.minStep = 1;
				characteristic.props.minValue = 1;
		 }
         		   if (characteristic.UUID == (new Characteristic.CurrentTemperature()).UUID) {
                characteristic.props.minValue = -50;
			}
			this.platform.bindCharacteristicEvents(characteristic, service.controlService);
		}
	}
};

function hexToR(h) {
	return parseInt((cutHex(h)).substring(0, 2), 16);
}

function hexToG(h) {
	return parseInt((cutHex(h)).substring(2, 4), 16);
}

function hexToB(h) {
	return parseInt((cutHex(h)).substring(4, 6), 16);
}

function cutHex(h) {
	return (h.charAt(0) == '#') ? h.substring(1, 7) : h;
}

function rgbToHex(R, G, B) {
	return '#' + toHex(R) + toHex(G) + toHex(B);
}

function toHex(n) {
	n = parseInt(n, 10);
	if (isNaN(n))
		return '00';
	n = Math.max(0, Math.min(n, 255));
	return '0123456789ABCDEF'.charAt((n - n % 16) / 16) + '0123456789ABCDEF'.charAt(n % 16);
}

function HSVtoRGB(hue, saturation, value) {
	var h = hue / 360.0;
	var s = saturation / 100.0;
	var v = value / 100.0;
	var r, g, b, i, f, p, q, t;
	if (arguments.length === 1) {
		s = h.s, v = h.v, h = h.h;
	}
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
	case 0:
		r = v, g = t, b = p;
		break;
	case 1:
		r = q, g = v, b = p;
		break;
	case 2:
		r = p, g = v, b = t;
		break;
	case 3:
		r = p, g = q, b = v;
		break;
	case 4:
		r = t, g = p, b = v;
		break;
	case 5:
		r = v, g = p, b = q;
		break;
	}
	return {
		r : Math.round(r * 255),
		g : Math.round(g * 255),
		b : Math.round(b * 255)
	};
}

function RGBtoHSV(r, g, b) {
	if (arguments.length === 1) {
		g = r.g, b = r.b, r = r.r;
	}
	var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h, s = (max === 0 ? 0 : d / max), v = max / 255;

	switch (max) {
	case min:
		h = 0;
		break;
	case r:
		h = (g - b) + d * (g < b ? 6 : 0);
		h /= 6 * d;
		break;
	case g:
		h = (b - r) + d * 2;
		h /= 6 * d;
		break;
	case b:
		h = (r - g) + d * 4;
		h /= 6 * d;
		break;
	}

	return {
		h : h * 360.0,
		s : s * 100.0,
		v : v * 100.0
	};
}
