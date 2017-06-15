// Jeedom Platform plugin for HomeBridge
//

'use strict';

var Accessory, Service, Characteristic, UUIDGen;
var inherits = require('util').inherits;
var myLogger = require('./lib/myLogger').myLogger;
var debug = {};
debug.DEBUG = 100;
debug.INFO = 200;
debug.WARN = 300;
debug.ERROR = 400;
debug.NO = 1000;
var hasError = false;
const DEV_DEBUG=false;

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;
	RegisterCustomCharacteristics();
	homebridge.registerPlatform('homebridge-jeedom', 'Jeedom', JeedomPlatform, true);
};

// -- JeedomPlatform
// -- Desc : Main Class, used by Homebridge to construct the platform object
// -- Params --
// -- logger : homebridge logger object, contain a prefix
// -- config : homebridge's config.json file object
// -- api : homebridge api
// -- Return : nothing
function JeedomPlatform(logger, config, api) {
	try{
		this.config = config || {};
		this.accessories = [];
		this.debugLevel = config['debugLevel'] || debug.ERROR;
		this.log = myLogger.createMyLogger(this.debugLevel,logger);
		this.log('debugLevel:'+this.debugLevel);
		
		if (config["url"] == "undefined" || 
		    config["url"] == "http://:80") {
			this.log('error',"Adresse Jeedom non configurée, Veuillez la configurer avant de relancer.");
			process.exit(1);
		}else{
			this.log('info',"Adresse Jeedom bien configurée :"+config["url"]);	
		}
		this.jeedomClient = require('./lib/jeedom-api').createClient(config['url'], config['apikey'], this);
		this.rooms = {};
		this.updateSubscriptions = [];
		
		this.lastPoll = 0;
		this.pollingUpdateRunning = false;
		this.pollingID = null;
		
		this.pollerPeriod = config['pollerperiod'];
		if ( typeof this.pollerPeriod == 'string')
			this.pollerPeriod = parseInt(this.pollerPeriod);
		else if (this.pollerPeriod == undefined)
			this.pollerPeriod = 0.5; // 0.5 is Nice between 2 calls
		
		if (api) {
			this.api = api;
			this.api.on('didFinishLaunching',function(){
				this.addAccessories();
			}.bind(this));
		}
	}
	catch (e) {
		this.log('error','Erreur de la Fonction JeedomPlatform : '+e);	
	}
}

// -- addAccessories
// -- Desc : Accessories creation, we get a full model from jeedom and put it in local cache
// -- Return : nothing
JeedomPlatform.prototype.addAccessories = function() {
	try{
		var that = this;
		that.log('Synchronisation Jeedom <> Homebridge...');
		that.jeedomClient.getModel()
			.then(function(model){ // we got the base Model from the API
				that.lastPoll=model.config.datetime;
				that.log('Enumération des objets Jeedom (Pièces)...');
				model.objects.map(function(r){
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

// -- JeedomDevices2HomeKitAccessories
// -- Desc : Translate JeedomDevices into Homebridge Accessories
// -- Params --
// -- devices : eqLogics from jeedom
// -- Return : nothing
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
				if (device.isVisible == '1' && 
				    device.object_id != null && 
				    device.sendToHomebridge != '0') { // we dont receive not visible and empty room, so the only test here is sendToHomebridge

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
										characteristics : [Characteristic.BatteryLevel,Characteristic.ChargingState,Characteristic.StatusLowBattery]
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
						if (cmds.DoorBell) {
							cmds.DoorBell.forEach(function(cmd, index, array) {
								service = {
									controlService : new Service.Doorbell(_params.name),
									characteristics : [Characteristic.ProgrammableSwitchEvent]
								};
								service.controlService.cmd_id = cmd.state.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = '';
								service.controlService.subtype = _params.id + '-' + cmd.state.id + '-' + service.controlService.subtype;
								services.push(service);
								service = null;
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
		
		if(!hasError)
		{
			that.log('┌────RAMASSE-MIETTES─────');
			that.log('│ (Suppression des accessoires qui sont dans le cache mais plus dans jeedom (peut provenir de renommage ou changement de pièce))');
			var hasDeleted = false
			var countA=0;
			for (var a in that.accessories) 
			{
				if(!that.accessories[a].reviewed && 
				   that.accessories[a].displayName) {
					that.log('│ ┌──── Trouvé: '+that.accessories[a].displayName);
					that.delAccessory(that.accessories[a],true);
					that.log('│ │ Supprimé du cache !');
					that.log('│ └─────────');
					hasDeleted=true;
				}else if(that.accessories[a].reviewed && 
					 that.accessories[a].displayName) countA++;
			}
			if(!hasDeleted) that.log('│ Rien à supprimer');
			that.log('└────────────────────────');
		}
		else
		{
			that.log('error','!!! ERREUR DETECTÉE, ON QUITTE HOMEBRIDGE !!!');
			process.exit(1);
		}
		var endLog = '--== Homebridge est démarré et a intégré '+countA+' accessoire'+ (countA>1 ? 's' : '') +' ! (Si vous avez un Warning Avahi, ne pas en tenir compte) ==--';
		that.log(endLog);
		if(countA >= 100) that.log('error','!!! ATTENTION !!! Vous avez '+countA+' accessoires + Jeedom et HomeKit en supporte 100 max au total !!');
		else if(countA >= 90) that.log('warn','!! Avertissement, vous avez '+countA+' accessoires + Jeedom et HomeKit en supporte 100 max au total !!');
		
		that.log('debug','==START POLLING==');
		that.startPollingUpdate();
	}
	catch(e){
		this.log('error','Erreur de la fonction JeedomDevices2HomeKitAccessories :'+e);
	}
};

// -- createAccessory
// -- Desc : Create the JeedomBridgedAccessory object
// -- Params --
// -- services : translated homebridge services
// -- id : Jeedom id
// -- name : Jeedom name
// -- currentRoomID : Jeedom Room id
// -- eqType_name : type of the eqLogic
// -- logicalId : Jeedom logicalId
// -- Return : a JeedomBridgedAccessory object
JeedomPlatform.prototype.createAccessory = function(services, id, name, currentRoomID, eqType_name, logicalId) {
	try{
		var accessory = new JeedomBridgedAccessory(services);
		accessory.platform = this;
		accessory.log = this.log;
		accessory.name = (name) ? name : this.rooms[currentRoomID] + '-Devices';

		accessory.UUID = UUIDGen.generate(id + accessory.name);
		accessory.context = {};
		accessory.context.uniqueSeed = id + accessory.name;

		accessory.model = eqType_name;
		accessory.manufacturer = 'Jeedom>'+ this.rooms[currentRoomID] +'>'+name;
		accessory.serialNumber = '<'+id+'-'+logicalId+'>';
		accessory.services_add = services;
		return accessory;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction createAccessory :'+e);
		hasError=true;
	}
};

// -- delAccessory
// -- Desc : deleting an Accessory from homebridge (if exists) and the local list
// -- Params --
// -- jeedomAccessory : JeedomBridgedAccessory to delete
// -- silence : flag for logging or not
// -- Return : nothing
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
		hasError=true;
	}
};

// -- addAccessory
// -- Desc : adding or updating an Accessory to homebridge and local list
// -- Params --
// -- jeedomAccessory : JeedomBridgedAccessory to add
// -- Return : nothing
JeedomPlatform.prototype.addAccessory = function(jeedomAccessory) {
	try{
		if (!jeedomAccessory) {
			return;
		}
		let isNewAccessory = false;
		let uniqueSeed = jeedomAccessory.UUID;
		let services2Add = jeedomAccessory.services_add;
		this.log('│ Vérification d\'existance de l\'accessoire dans Homebridge...');
		let HBAccessory = this.existingAccessory(uniqueSeed);
		if (!HBAccessory) {
			this.log('│ Nouvel accessoire (' + jeedomAccessory.name + ')');
			isNewAccessory = true;
			HBAccessory = new Accessory(jeedomAccessory.name, jeedomAccessory.UUID);
			jeedomAccessory.initAccessory(HBAccessory);
			this.accessories[jeedomAccessory.UUID] = HBAccessory;
		}
		//HBAccessory.reachable = true;
		HBAccessory.updateReachability(true);
		
		if (isNewAccessory) {
			this.log('│ Ajout de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.registerPlatformAccessories('homebridge-jeedom', 'Jeedom', [HBAccessory]);
		}else{
			let cachedValues=jeedomAccessory.delServices(HBAccessory);
			jeedomAccessory.addServices(HBAccessory,services2Add,cachedValues);
			this.log('│ Mise à jour de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.updatePlatformAccessories([HBAccessory]);
		}
		HBAccessory.on('identify', function(paired, callback) {
			this.log(HBAccessory.displayName, "->Identify!!!");
			callback();
		}.bind(this));
		HBAccessory.reviewed = true;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction addAccessory :'+e);
		hasError=true;
	}
};

// -- existingAccessory
// -- Desc : check if the accessory exists in the local list
// -- Params --
// -- uniqueSeed : UUID to find
// -- silence : flag for logging or not
// -- Return : nothing
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
		hasError=true;
	}
};

// -- configureAccessory
// -- Desc : Launched by Homebridge on the beginning, bind the event to the accessory found in the cache
// -- Params --
// -- accessory : the accessory to configure
// -- Return : nothing
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
		hasError=true;
	}
};

// -- bindCharacteristicEvents
// -- Desc : bind the set and get event to the characteristic
// -- Params --
// -- characteristic : characteristic to bind event to
// -- service : service of the characteristic
// -- Return : nothing
JeedomPlatform.prototype.bindCharacteristicEvents = function(characteristic, service) {
	try{
		var readOnly = true;
		for (var i = 0; i < characteristic.props.perms.length; i++)
			if (characteristic.props.perms[i] == 'pw')
				readOnly = false;
		var IDs = service.subtype.split('-');
		let propertyChanged = 'value';
		if (service.HSBValue != undefined)
			propertyChanged = 'color';
		this.subscribeUpdate(service, characteristic, propertyChanged);
		if (!readOnly) {
			characteristic.on('set', function(value, callback, context) {
				if (context !== 'fromJeedom' && context !== 'fromSetValue') { // from Homekit
					this.log('info','[Commande d\'Homekit] Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+characteristic.value+'->'+value,'\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
					this.setAccessoryValue(value,characteristic,service,IDs);
				}
				else
					this.log('info','[Commande de Jeedom] Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+value,'\t\t\t\t\t|||context:'+JSON.stringify(context),'characteristic:'+JSON.stringify(characteristic));
				callback();
			}.bind(this));
		}
		characteristic.on('get', function(callback) {
			this.log('info','[Demande d\'Homekit] IDs:'+IDs,'Nom:'+service.displayName+'>'+characteristic.displayName+'='+characteristic.value,'\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
			let returnValue = this.getAccessoryValue(characteristic, service, IDs);
			callback(undefined, returnValue);
		}.bind(this));
	}
	catch(e){
		this.log('error','Erreur de la fonction bindCharacteristicEvents :'+e);
		hasError=true;
	}
};

// -- setAccessoryValue
// -- Desc : set the value of an accessory in Jeedom
// -- Params --
// -- value : the value to set
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.setAccessoryValue = function(value, characteristic, service, IDs) {
	try{
		//var that = this;
		switch (characteristic.UUID) {
			case Characteristic.On.UUID :
					this.command(value == 0 ? 'turnOff' : 'turnOn', null, service, IDs);
			break;
			case Characteristic.TargetTemperature.UUID :
				if (Math.abs(value - characteristic.value) >= 0.5) {
					value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
					this.command('setTargetLevel', value, service, IDs);
				} else {
					value = characteristic.value;
				}
				setTimeout(function() {
					characteristic.setValue(value, undefined, 'fromSetValue');
				}, 100);
			break;
			case Characteristic.TimeInterval.UUID :
				this.command('setTime', value + Math.trunc((new Date()).getTime() / 1000), service, IDs);
			break;
			case Characteristic.TargetHeatingCoolingState.UUID :
				this.log('set target mode');
				this.command('TargetHeatingCoolingState', value, service, IDs);
			break;
			case Characteristic.TargetDoorState.UUID :
				var action = 'GBtoggle';//value == Characteristic.TargetDoorState.OPEN ? 'GBopen' : 'GBclose';
				this.command(action, 0, service, IDs);
			break;
			case Characteristic.LockTargetState.UUID :
				var action = value == Characteristic.LockTargetState.UNSECURED ? 'unsecure' : 'secure';
				this.command(action, 0, service, IDs);
			break;
			case Characteristic.Hue.UUID :
				var rgb = this.updateJeedomColorFromHomeKit(value, null, null, service);
				this.syncColorCharacteristics(rgb, service, IDs);
			break;
			case Characteristic.Saturation.UUID :
				var rgb = this.updateJeedomColorFromHomeKit(null, value, null, service);
				this.syncColorCharacteristics(rgb, service, IDs);
			break;
			case Characteristic.Brightness.UUID :
				if (service.HSBValue != null) {
					var rgb = this.updateJeedomColorFromHomeKit(null, null, value, service);
					this.syncColorCharacteristics(rgb, service, IDs);
				} else {
					this.command('setValue', value, service, IDs);
				}
			break;
			default :
				this.command('setValue', value, service, IDs);
			break;
		}
	
	}
	catch(e){
		this.log('error','Erreur de la fonction setAccessoryValue :'+e);
	}
};

// -- getAccessoryValue
// -- Desc : Get the value of an accessory in the jeedom local cache
// -- Params --
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.getAccessoryValue = function(characteristic, service, IDs) {
	try{
		var that = this;
		var cmds = IDs[1].split('|');
		let returnValue = 0;
		var cmdList = that.jeedomClient.getDeviceCmd(IDs[0]);
		
		switch (characteristic.UUID) {
			case Characteristic.OutletInUse.UUID :
				returnValue = parseFloat(cmdList.power) > 1.0 ? true : false;
			break;
			case Characteristic.TimeInterval.UUID :
				returnValue = Date.now();
				returnValue = parseInt(cmdList.timestamp) - returnValue;
				if (returnValue < 0) returnValue = 0;
			break;
			case Characteristic.TargetTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_SETPOINT') {
						returnValue = parseInt(cmd.currentValue);
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
			break;
			case Characteristic.Hue.UUID :
				returnValue = undefined;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				var hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.h);
			break;
			case Characteristic.Saturation.UUID :
				returnValue = undefined;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				var hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.v);
			break;
			case Characteristic.SmokeDetected.UUID :
				returnValue = '';
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SMOKE' && cmd.id == cmds[0]) {
						returnValue = parseInt(cmd.currentValue);
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
				returnValue = returnValue == 1 ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
			break;
			case Characteristic.LeakDetected.UUID :
				returnValue = '';
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLOOD' && cmd.id == cmds[0]) {
						returnValue = parseInt(cmd.currentValue);
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
				returnValue = returnValue == 1 ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED;
			break;
			case Characteristic.ContactSensorState.UUID :
				returnValue = '';
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'OPENING' && cmd.id == cmds[0]) {
						returnValue = parseInt(cmd.currentValue);
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
				returnValue = returnValue == 1 ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED;
			break;
			case Characteristic.Brightness.UUID :
				returnValue = undefined;
				
				for (const cmd of cmdList) {
					if (service.HSBValue != null) {
						if (cmd.generic_type == 'LIGHT_COLOR') {
							//console.log("valeur " + cmd.generic_type + " : " + returnValue);
							var hsv = that.updateHomeKitColorFromJeedom(cmd.currentValue, service);
							returnValue = Math.round(hsv.v);
							break;
						}
					} else if (cmd.generic_type == 'LIGHT_STATE' && cmd.id == cmds[0]) {
						returnValue = Math.round(parseInt(cmd.currentValue) * 100/99); // brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to %
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
			break;
			case Characteristic.SecuritySystemTargetState.UUID :
			case Characteristic.SecuritySystemCurrentState.UUID :
				for (const cmd of cmdList) {
					let currentValue = parseInt(cmd.currentValue);
					
					if (cmd.generic_type == 'ALARM_STATE' && currentValue == 1) {
						//console.log("valeur " + cmd.generic_type + " : alarm");
						returnValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
						break;
					}
					if (cmd.generic_type == 'ALARM_ENABLE_STATE') {
						switch (currentValue) {
							case 0 :
								returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
							break;
							default:
								returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;							
							break;
						}
					}
				}
			break;
			case Characteristic.CurrentHeatingCoolingState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_MODE') {
						if (cmd.currentValue == 'Off') {
							returnValue = Characteristic.CurrentHeatingCoolingState.OFF;
						} else {
							returnValue = Characteristic.CurrentHeatingCoolingState.AUTO;
						}
						break;
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
					}
				}
			break;
			case Characteristic.PositionState.UUID :
				returnValue = Characteristic.PositionState.STOPPED;
			break;
			case Characteristic.ProgrammableSwitchEvent.UUID :
				returnValue = cmdList.value;
				that.log('debug','GetState ProgrammableSwitchEvent: '+returnValue);
			break;
			case Characteristic.LockCurrentState.UUID :
			case Characteristic.LockTargetState.UUID :
				returnValue = cmdList.value == 'true' ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
			break;
			case Characteristic.CurrentDoorState.UUID :
			case Characteristic.TargetDoorState.UUID :
				returnValue=undefined;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
					    cmd.generic_type == 'BARRIER_STATE') {
						switch(parseInt(cmd.currentValue)) {
								case 255 :
										returnValue=Characteristic.CurrentDoorState.OPEN; //0
								break;
								case 0 :
										returnValue=Characteristic.CurrentDoorState.CLOSED; // 1
								break;
								case 254 :
										returnValue=Characteristic.CurrentDoorState.OPENING; // 2
								break;
								case 252 :
										returnValue=Characteristic.CurrentDoorState.CLOSING; // 3
								break;
								case 253 :
										returnValue=Characteristic.CurrentDoorState.STOPPED; // 4
								break;
						}
						that.log('debug','GetState Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue);
						break;
					}
				}
			break;
			case Characteristic.CurrentPosition.UUID :
			case Characteristic.TargetPosition.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLAP_STATE' && cmd.id == cmds[0]) {
						returnValue = parseInt(cmd.currentValue) > 95 ? 100 : parseInt(cmd.currentValue); // >95% is 100% in home (flaps need yearly tunning)
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
			break;
			case Characteristic.CurrentTemperature.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'TEMPERATURE' && cmd.id == cmds[0]) || 
					    cmd.generic_type == 'THERMOSTAT_TEMPERATURE') {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				returnValue = parseFloat(returnValue);
			break;
			case Characteristic.CurrentAmbientLightLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BRIGHTNESS' && cmd.id == cmds[0]) {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = prepareValue(cmd.currentValue,characteristic);
						break;
					}
				}
			break;
			case Characteristic.CurrentRelativeHumidity.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'HUMIDITY' && cmd.id == cmds[0]) {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				returnValue = parseInt(returnValue);
			break;
			case Characteristic.BatteryLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == cmds[0]) {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				returnValue = parseInt(returnValue);
			break;
			case Characteristic.StatusLowBattery.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == cmds[0]) {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				if(parseInt(returnValue) > 20) returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
				else returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
			break;
			case Characteristic.ChargingState.UUID :
				//Characteristic.ChargingState.NOT_CHARGING;
				//Characteristic.ChargingState.CHARGING;
				returnValue = Characteristic.ChargingState.NOT_CHARGEABLE;
			break;
			case Characteristic.CurrentPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'POWER' && cmd.id == cmds[0]) {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				returnValue = parseFloat(returnValue);
			break;
			case Characteristic.TotalPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CONSUMPTION' && cmd.id == cmds[0]) {
						//console.log("valeur " + cmd.generic_type + " : " + cmd.currentValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				returnValue = parseFloat(returnValue);
			break;
		}
		if (characteristic.props.format == 'bool') {
			for (const cmd of cmdList) {
				if (	(cmd.generic_type == "LIGHT_STATE" && cmd.id == cmds[0]) || 
					(cmd.generic_type == "ENERGY_STATE" && cmd.id == cmds[0]) || 
					(cmd.generic_type == "PRESENCE" && cmd.id == cmds[0]) || 
					(cmd.generic_type == "OPENING" && cmd.id == cmds[0])) 
				{
					returnValue = cmd.currentValue;
					//console.log("valeur binary " + cmd.generic_type + " : " + v);
				}
			}
			returnValue = toBool(returnValue);
		}
		return returnValue;
	}
	catch(e){
		this.log('error','Erreur de la fonction getAccessoryValue :'+e);
	}
};

// -- prepareValue
// -- Desc : limit the value to the min and max characteristic + round the float to the same precision than the minStep
// -- Params --
// -- currentValue : value to prepare
// -- characteristic : characteristic containing the props
// -- Return : prepared value
function prepareValue(currentValue,characteristic) {
	let val;
	switch(characteristic.props.format) {
			case "int" :
				val = parseInt(currentValue);
			break;
			case "float" :
				val = minStepRound(parseFloat(currentValue),characteristic);
			break;
			case "bool" :
				val = toBool(currentValue);
			break;
			default : // uint8, string
				val = currentValue;
			break;
	}
	if(characteristic.props.minValue != null && val < characteristic.props.minValue) val = characteristic.props.minValue;
	if(characteristic.props.maxValue != null && val > characteristic.props.maxValue) val = characteristic.props.maxValue;
	return val;
}

// -- minStepRound
// -- Desc : round the value to the same precision than the minStep
// -- Params --
// -- val : value to round
// -- characteristic : characteristic containing the props
// -- Return : rounded value
function minStepRound(val,characteristic) {
	if(characteristic.props.minStep != null) {
		let prec = (characteristic.props.minStep.toString().split('.')[1] || []).length
		val = val * Math.pow(10, prec);
		val = Math.round(val); // round to the minStep precision
		val = val / Math.pow(10, prec);
	}	
	return val;
}

// -- command
// -- Desc : Command from Homebridge to execute in Jeedom
// -- Params --
// -- action : command type
// -- value : value to set (if any)
// -- service : from which Homebridge service
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.command = function(action, value, service, IDs) {
	try{
		var that = this;
		var cmds = IDs[1].split('|');
		if (service.UUID == Service.SecuritySystem.UUID) {
			action = 'SetAlarmMode';
		} else if (value == 0 && service.UUID == Service.WindowCovering.UUID) {
			action = 'flapDown';
		} else if ((value == 99 || value == 100) && service.UUID == Service.WindowCovering.UUID) {
			action = 'flapUp';
		}
		var cmdList = that.jeedomClient.getDeviceCmd(IDs[0]); 
		var cmdId = cmds[0];
		for (const cmd of cmdList) {
			if (action == 'flapDown' && cmd.generic_type == 'FLAP_DOWN') {
				cmdId = cmd.id;
				break;
			} else if (action == 'flapUp' && cmd.generic_type == 'FLAP_UP') {
				cmdId = cmd.id;
				break;
			} else if (action == 'GBopen' && cmd.generic_type == 'GB_OPEN') {
				cmdId = cmd.id;
				break;
			} else if (action == 'GBclose' && cmd.generic_type == 'GB_CLOSE') {
				cmdId = cmd.id;
				break;
			} else if (action == 'GBtoggle' && cmd.generic_type == 'GB_TOGGLE') {
				cmdId = cmd.id;
				break;
			} else if (action == 'unsecure' && cmd.generic_type == 'LOCK_OPEN') {
				cmdId = cmd.id;
				break;
			} else if (action == 'secure' && cmd.generic_type == 'LOCK_CLOSE') {
				cmdId = cmd.id;
				break;
			} else if (value >= 0 && 
				   cmd.id == cmds[3] && 
				   (cmd.generic_type == 'LIGHT_SLIDER' || cmd.generic_type == 'FLAP_SLIDER')) { // don't like... need to change...
				
				cmdId = cmd.id;
				if (action == 'turnOn' && cmds[1]) {
					cmdId=cmds[1];
				} else if (action == 'turnOff' && cmds[2]) {
					cmdId=cmds[2];
				}
				// brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to Zwave
				value =	Math.round(value * 99/100);
				break;
			} else if ((value == 255 || action == 'turnOn') && 
				    cmd.id == cmds[1] && 
				   (cmd.generic_type == 'LIGHT_ON' || cmd.generic_type == 'ENERGY_ON')) {
				cmdId = cmd.id;
				break;
			} else if ((value == 0 || action == 'turnOff') && 
				    cmd.id == cmds[2] && 
				   (cmd.generic_type == 'LIGHT_OFF' || cmd.generic_type == 'ENERGY_OFF')) {
				cmdId = cmd.id;
				break;
			} else if (action == 'setRGB' && cmd.generic_type == 'LIGHT_SET_COLOR') {
				cmdId = cmd.id;
				break;
			} else if (action == 'SetAlarmMode' && cmd.generic_type == 'ALARM_ARMED' && value < 3) {
				cmdId = cmd.id;
				break;
			} else if (action == 'SetAlarmMode' && cmd.generic_type == 'ALARM_RELEASED' && value == 3) {
				cmdId = cmd.id;
				break;
			} else if (action == 'setTargetLevel' && 
				   value > 0 && 
				   cmd.generic_type == 'THERMOSTAT_SET_SETPOINT') {
				cmdId = cmd.id;
				break;
			} else if (action == 'TargetHeatingCoolingState') {
				if (cmd.generic_type == 'THERMOSTAT_SET_MODE' && cmd.name == 'Off') {
					cmdId = cmd.id;
					break;
				}
			}
		}
		
		that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
			that.log('info','[Commande envoyée à Jeedom] cmdId:' + cmdId,'action:' + action,'value: '+value,'response:'+JSON.stringify(response));
		}).catch(function(err, response) {
			that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + IDs[0] + ' | ' + err + ' - ' + response);
		});

	}
	catch(e){
		this.log('error','Erreur de la fonction command :'+e);	
	}
};

// -- subscribeUpdate
// -- Desc : Populate the subscriptions to the characteristic. if the value is changed, the characteristic will be updated
// -- Params --
// -- service : service containing the characteristic to subscribe to
// -- characteristic : characteristic to subscribe to
// -- propertyChanged : value or color
// -- Return : nothing
JeedomPlatform.prototype.subscribeUpdate = function(service, characteristic, propertyChanged) {
	try{
		if (characteristic.UUID == Characteristic.PositionState.UUID)
			return;

		var IDs = service.subtype.split('-');
		this.updateSubscriptions.push({
			'id' : IDs[0],
			'service' : service,
			'characteristic' : characteristic,
			'property' : propertyChanged
		});
	}
	catch(e){
		this.log('error','Erreur de la fonction subscribeUpdate :'+e);
		hasError=true;
	}
};

// -- startPollingUpdate
// -- Desc : Get the last status from Jeedom and act on it (update model and subscribers)
// -- Params --
// -- Return : nothing
JeedomPlatform.prototype.startPollingUpdate = function() {
	var that = this;
	if(that.pollingUpdateRunning) {return;}
	that.pollingUpdateRunning = true;
	that.jeedomClient.refreshStates().then(function(updates) {
		that.lastPoll = updates.datetime;
		if (updates.result != undefined) {
			updates.result.map(function(update) {
				if (update.name == 'cmd::update' && 
				    update.option.value != undefined && 
				    update.option.cmd_id != undefined) {
					that.jeedomClient.updateModelInfo(update.option.cmd_id,update.option.value); // Update cachedModel
					setTimeout(function(){that.updateSubscribers(update)},50);
				}
				else {
					if(DEV_DEBUG) that.log('debug','[Reçu Type non géré]: '+update.name+' contenu: '+JSON.stringify(update).replace("\n",""));
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

// -- updateSubscribers
// -- Desc : update subcribers populated by the subscribeUpdate method
// -- Params --
// -- update : the update received from Jeedom
// -- Return : nothing
JeedomPlatform.prototype.updateSubscribers = function(update) {
	var that = this;

	var FC = update.option.value[0];
	
	if(FC == '#') update.color=update.option.value;
	else update.color=undefined;
	
	var value = parseInt(update.option.value);
	if (isNaN(value))
		value = (update.option.value === 'true');
	
	if (update.name == 'cmd::update' && 
	    update.option.value != undefined && 
	    update.option.cmd_id != undefined) {
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
				var intervalValue = false;

				switch(subscription.characteristic.UUID) {
					case Characteristic.TimeInterval.UUID :
						intervalValue = true;
					break;
					case Characteristic.SmokeDetected.UUID :
						subscription.characteristic.setValue(value == 0 ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED, undefined, 'fromJeedom');		
					break;
					case Characteristic.SecuritySystemCurrentState.UUID :
						if (cmd2_id == update.option.cmd_id && value == 1) {
							subscription.characteristic.setValue(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED, undefined, 'fromJeedom');
						} 
						else {
							subscription.characteristic.setValue(value == 0 ? Characteristic.SecuritySystemCurrentState.DISARMED : Characteristic.SecuritySystemCurrentState.ARM_AWAY, undefined, 'fromJeedom');
						}
					break;
					case Characteristic.SecuritySystemTargetState.UUID :
						subscription.characteristic.setValue(value == 0 ? Characteristic.SecuritySystemCurrentState.DISARMED : Characteristic.SecuritySystemCurrentState.ARM_AWAY, undefined, 'fromJeedom');
					break;
					case Characteristic.LeakDetected.UUID :
						subscription.characteristic.setValue(value == 0 ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED, undefined, 'fromJeedom');
					break;
					case Characteristic.ContactSensorState.UUID :
						subscription.characteristic.setValue(value == 0 ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED, undefined, 'fromJeedom');
					break;
					case Characteristic.CurrentDoorState.UUID :
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
					break;
					case Characteristic.TargetDoorState.UUID :
						subscription.characteristic.setValue(!value, undefined, 'fromJeedom');
					break;
					case Characteristic.ProgrammableSwitchEvent.UUID :
						that.log('debug',"Valeur de ProgrammableSwitchEvent :"+value);
						subscription.characteristic.setValue(value, undefined, 'fromJeedom');
					break;
					case Characteristic.LockCurrentState.UUID :
					case Characteristic.LockTargetState.UUID :
						subscription.characteristic.setValue(value == 1 ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED, undefined, 'fromJeedom');
					break;
					case Characteristic.CurrentPosition.UUID :
					case Characteristic.TargetPosition.UUID :
						if (value >= subscription.characteristic.props.minValue && value <= subscription.characteristic.props.maxValue)
							subscription.characteristic.setValue(value, undefined, 'fromJeedom');
					break;
					case Characteristic.OutletInUse.UUID :
						if (update.power != undefined)
							subscription.characteristic.setValue(parseFloat(update.power) > 1.0 ? true : false, undefined, 'fromJeedom');
					break;
					case Characteristic.Brightness.UUID :
						subscription.characteristic.setValue(Math.round(value * 100/99), undefined, 'fromJeedom');
					break;
					default :
						if ((subscription.characteristic.props.format == 'bool' && typeof (value) == 'boolean') || subscription.characteristic.props.format != 'bool') {
							subscription.characteristic.setValue(value, undefined, 'fromJeedom');
						} 
						else {
							subscription.characteristic.setValue(toBool(value), undefined, 'fromJeedom');
						}	
					break;
				} 
			}
		}
	}
	if (update.color != undefined) {
		var found=false;
		for (var i = 0; i < that.updateSubscriptions.length; i++) {
			var subscription = that.updateSubscriptions[i];
			var IDs = subscription.service.subtype.split('-');
			if (IDs[1] == update.option.cmd_id && subscription.property == 'color') {
				var hsv = that.updateHomeKitColorFromJeedom(update.color, subscription.service);
				switch(subscription.characteristic.UUID)
				{
					case Characteristic.On.UUID :
						that.log('debug','update On :'+hsv.v == 0 ? false : true);
						subscription.characteristic.setValue(hsv.v == 0 ? false : true, undefined, 'fromJeedom');
					break;
					case Characteristic.Hue.UUID :
						//that.log('debug','update Hue :'+Math.round(hsv.h));
						subscription.characteristic.setValue(Math.round(hsv.h), undefined, 'fromJeedom');
					break;
					case Characteristic.Saturation.UUID :
						//that.log('debug','update Sat :'+Math.round(hsv.s));
						subscription.characteristic.setValue(Math.round(hsv.s), undefined, 'fromJeedom');
					break;
					case Characteristic.Brightness.UUID :
						//that.log('debug','update Bright :'+Math.round(hsv.v));
						subscription.characteristic.setValue(Math.round(hsv.v), undefined, 'fromJeedom');
					break;
				}
				found=true;
			}
			else if (found==true) // after all founds
			{
				break;
			}
		}
	}
};

// -- updateJeedomColorFromHomeKit
// -- Desc : convert HSV value (Homebridge) to html value (Jeedom)
// -- Params --
// -- h : Hue
// -- s : Saturation
// -- v : Value (brightness)
// -- service : service containing the color
// -- Return : rgb object
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

// -- updateHomeKitColorFromJeedom
// -- Desc : convert html value (Jeedom) to HSV value (Homebridge)
// -- Params --
// -- color : html color #121212
// -- service : service containing the color
// -- Return : hsv object
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

// -- syncColorCharacteristics
// -- Desc : set color in jeedom
// -- Params --
// -- rgb : rgb object
// -- service : service to set color to
// -- IDs : eqLogic ID
// -- Return : nothing
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

// -- RegisterCustomCharacteristics
// -- Desc : Register some custom characteristic in Homebridge
// -- Params --
// -- Return : nothing
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

// -- JeedomBridgedAccessory
// -- Desc : Bridged Class, used by Homebridge to construct the Bridged platform object
// -- Params --
// -- services : Services of the Accessory
// -- Return : nothing
function JeedomBridgedAccessory(services) {
	this.services = services;
}

// -- initAccessory
// -- Desc : setting the main Characteristic of the Accessory (Manufacturer, ...) and adding services
// -- Params --
// -- newAccessory : the Accessory to add the services to
// -- Return : nothing
JeedomBridgedAccessory.prototype.initAccessory = function(newAccessory) {
	newAccessory
	   .getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
		.setCharacteristic(Characteristic.Model, this.model)
		.setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

	this.addServices(newAccessory,this.services,[]);
};

// -- addServices
// -- Desc : adding the services to the accessory and rebind event if needed
// -- Params --
// -- newAccessory : accessory to add the services too
// -- services : services to be added
// -- Return : nothing
JeedomBridgedAccessory.prototype.addServices = function(newAccessory,services,cachedValues) {
	try {
		for (var s = 0; s < services.length; s++) {
			var service = services[s];
			
			this.log('info',' Ajout service :'+service.controlService.displayName+' subtype:'+service.controlService.subtype+' cmd_id:'+service.controlService.cmd_id+' UUID:'+service.controlService.UUID);
			newAccessory.addService(service.controlService);
			for (var i = 0; i < service.characteristics.length; i++) {
				var characteristic = service.controlService.getCharacteristic(service.characteristics[i]);
				
				var cachedValue = cachedValues[service.controlService.subtype+'>'+characteristic.displayName];
				if(cachedValue){
					characteristic.setValue(cachedValue, undefined, 'fromCache');
				}
				
				characteristic.props.needsBinding = true;
				/*if (characteristic.UUID == Characteristic.CurrentAmbientLightLevel.UUID) {
					characteristic.props.maxValue = 1000;
					characteristic.props.minStep = 1;
					characteristic.props.minValue = 1;
				}*/
				if (characteristic.UUID == Characteristic.CurrentTemperature.UUID) {
					characteristic.props.minValue = -50;
					characteristic.props.minStep = 0.01;
				}
				this.platform.bindCharacteristicEvents(characteristic, service.controlService);
				this.log('info','    Caractéristique :'+characteristic.displayName+' valeur initiale:'+characteristic.value);
			}
		}
	}
	catch(e){
		this.log('error','Erreur de la fonction addServices :'+e,JSON.stringify(service.controlService));
		hasError=true;
	}
}

// -- delServices
// -- Desc : deleting the services from the accessory
// -- Params --
// -- accessory : accessory to delete the services from
// -- Return : nothing
JeedomBridgedAccessory.prototype.delServices = function(accessory) {
	try {
			var serviceList=[];
			var cachedValues=[];
			for(var t=0; t< accessory.services.length;t++) { 
				if(accessory.services[t].UUID != Service.AccessoryInformation.UUID && 
				   accessory.services[t].UUID != Service.BridgingState.UUID)
					serviceList.push(accessory.services[t]);
			}		
			for(var service of serviceList){ // dont work in one loop or with temp object :(
				if(service.UUID != Service.AccessoryInformation.UUID && 
				   service.UUID != Service.BridgingState.UUID) {
					this.log('info',' Suppression service :'+service.displayName+' subtype:'+service.subtype+' UUID:'+service.UUID);
					for (const c of service.characteristics) {
						this.log('info','    Caractéristique :'+c.displayName+' valeur cache:'+c.value);
						cachedValues[service.subtype+'>'+c.displayName]=c.value;
					}
					accessory.removeService(service);
				}
			}
			return cachedValues;
	}
	catch(e){
		this.log('error','Erreur de la fonction delServices :'+e,JSON.stringify(service));
		hasError=true;
	}
}

// -- hexToR
// -- Desc : take the R value in a html color string
// -- Params --
// -- h : html color string
// -- Return : R value
function hexToR(h) {
	return parseInt((cutHex(h)).substring(0, 2), 16);
}

// -- hexToG
// -- Desc : take the G value in a html color string
// -- Params --
// -- h : html color string
// -- Return : G value
function hexToG(h) {
	return parseInt((cutHex(h)).substring(2, 4), 16);
}

// -- hexToB
// -- Desc : take the B value in a html color string
// -- Params --
// -- h : html color string
// -- Return : B value
function hexToB(h) {
	return parseInt((cutHex(h)).substring(4, 6), 16);
}

// -- cutHex
// -- Desc : trim the #
// -- Params --
// -- h : html color string
// -- Return : numeric value of html color
function cutHex(h) {
	return (h.charAt(0) == '#') ? h.substring(1, 7) : h;
}

// -- rgbToHex
// -- Desc : transform separated R G B into html color
// -- Params --
// -- R : Red value
// -- G : Green value
// -- B : Blue value
// -- Return : html color
function rgbToHex(R, G, B) {
	return '#' + toHex(R) + toHex(G) + toHex(B);
}

// -- toHex
// -- Desc : Transform to hex
// -- Params --
// -- n : number
// -- Return : hex value
function toHex(n) {
	n = parseInt(n, 10);
	if (isNaN(n))
		return '00';
	n = Math.max(0, Math.min(n, 255));
	return '0123456789ABCDEF'.charAt((n - n % 16) / 16) + '0123456789ABCDEF'.charAt(n % 16);
}

// -- HSVtoRGB
// -- Desc : Transofrm HSV to RGB
// -- Params --
// -- hue : Hue value
// -- saturation : Saturation value
// -- value : value (brightness) value
// -- Return : RGB object
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

// -- RGBtoHSV
// -- Desc : Transofrm RGB to HSV
// -- Params --
// -- r : Red value
// -- g : Green value
// -- b : Blue value
// -- Return : HSV object
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

// -- toBool
// -- Desc : transform to boolean a value
// -- Params --
// -- value : value to convert into boolean
// -- Return : boolean value
function toBool(val) {
	if (val == 'false' || val == '0') {
		return false;
	} else {
		return Boolean(val);
	}
}
