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
const GenericAssociated = ['GENERIC_INFO','SHOCK','UV','PRESSURE','NOISE','RAIN_CURRENT','RAIN_TOTAL','WIND_SPEED','WIND_DIRECTION'];

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
		this.debugLevel = config.debugLevel || debug.ERROR;
		this.log = myLogger.createMyLogger(this.debugLevel,logger);
		this.log('debugLevel:'+this.debugLevel);
		this.myPlugin = config.myPlugin;
		
		if (!config.url || 
		    config.url == "http://:80" ||
			config.url == 'https://:80') {
			this.log('error',"Adresse Jeedom non configurée, Veuillez la configurer avant de relancer.");
			process.exit(1);
		}else{
			this.log('info',"Adresse Jeedom bien configurée :"+config.url);	
		}
		this.jeedomClient = require('./lib/jeedom-api').createClient(config.url, config.apikey, this,config.myPlugin);
		this.rooms = {};
		this.updateSubscriptions = [];
		
		this.lastPoll = 0;
		this.pollingUpdateRunning = false;
		this.pollingID = null;
		this.temporizator = null;
		this.settingLight = false;
		
		this.pollerPeriod = config.pollerperiod;
		if ( typeof this.pollerPeriod == 'string')
			this.pollerPeriod = parseInt(this.pollerPeriod);
		else if (!this.pollerPeriod)
			this.pollerPeriod = 0.05; // 0.05 is Nice between 2 calls
		
		if (api) {
			this.api = api;
			this.api.on('didFinishLaunching',function(){
				this.addAccessories();
			}.bind(this));
		}
	}
	catch (e) {
		this.log('error','Erreur de la Fonction JeedomPlatform : ',e);	
		console.error(e.stack);
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
				if(!model) that.log('error','Model invalide > ',model);
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
				that.log('error','#2 Erreur de récupération des données Jeedom: ' , err , ' (' + response + ')');
				console.error(err.stack);
			});
	}
	catch(e){
		this.log('error','Erreur de la fonction addAccessories :',e);
		console.error(e.stack);
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
		if (devices) {
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
			
			devices.map(function(device) {
				if (//device.isVisible == '1' && 
					device.isEnable == '1' &&
				    device.object_id != null && 
				    device.sendToHomebridge != '0') {

					that.AccessoireCreateHomebridge(
						that.jeedomClient.ParseGenericType(
							device, 
							that.jeedomClient.getDeviceCmd(device.id)
						)
					);
				}
				else
				{
					that.log('debug','eqLogic > '+JSON.stringify(device).replace("\n",''));
					that.log('┌──── ' + that.rooms[device.object_id] + ' > ' +device.name+' ('+device.id+')');
					var Messg= '│ Accessoire ';
					Messg   += device.isVisible == '1' ? 'visible' : 'invisible';
					Messg   += device.isEnable == '1' ? ', activé' : ', désactivé';
					Messg   += device.object_id != null ? '' : ', pas dans une pièce';
					Messg   += device.sendToHomebridge != '0' ? '' : ', pas coché pour Homebridge';
					that.log(Messg);

					that.delAccessory(
						that.createAccessory([], device) // create a cached lookalike object for unregistering it
					);
					that.log('└─────────');
				}
				
			});
		}
		var countA=0;
		if(!hasError)
		{
			that.log('┌────RAMASSE-MIETTES─────');
			that.log('│ (Suppression des accessoires qui sont dans le cache mais plus dans jeedom (peut provenir de renommage ou changement de pièce))');
			var hasDeleted = false;
			for (var a in that.accessories) 
			{
				if (that.accessories.hasOwnProperty(a)) {
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
		this.log('error','Erreur de la fonction JeedomDevices2HomeKitAccessories :',e);
		console.error(e.stack);
	}
};

// -- AccessoireCreateHomebridge
// -- Desc : Prepare the service list
// -- Params --
// -- eqLogic : eqLogics from jeedom (and cmd's)
// -- Return : nothing
JeedomPlatform.prototype.AccessoireCreateHomebridge = function(eqLogic) {
	var createdAccessory;
	try {
		var that = this;
		var HBservices = [];
		var HBservice = null;	
		var eqServicesCopy = eqLogic.services;
		that.log('debug','eqLogic > '+JSON.stringify(eqLogic).replace("\n",''));
		that.log('┌──── ' + that.rooms[eqLogic.object_id] + ' > ' + eqLogic.name + ' (' + eqLogic.id + ')');
		if (eqLogic.services.light) {
			eqLogic.services.light.forEach(function(cmd) {
				if (cmd.state) {
					let LightType="Switch";
					let maxBright;
					HBservice = {
						controlService : new Service.Lightbulb(eqLogic.name),
						characteristics : [Characteristic.On]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.light.forEach(function(cmd1) {
						if (cmd1.state_bool) {
								Serv.infos.state_bool=cmd1.state_bool;
								//break;
						}
					});
					eqServicesCopy.light.forEach(function(cmd2) {
						if (cmd2.on) {
							if (cmd2.on.value == cmd.state.id || (Serv.infos.state_bool && cmd2.on.value == Serv.infos.state_bool.id)) {
								Serv.actions.on=cmd2.on;
							}
						} else if (cmd2.off) {
							if (cmd2.off.value == cmd.state.id || (Serv.infos.state_bool && cmd2.off.value == Serv.infos.state_bool.id)) {
								Serv.actions.off=cmd2.off;
							}
						} else if (cmd2.slider) {
							if (cmd2.slider.value == cmd.state.id) {
								Serv.actions.slider=cmd2.slider;
							}
						} else if (cmd2.setcolor) {
							eqServicesCopy.light.forEach(function(cmd3) {
								if (cmd3.color) {
									Serv.infos.color=cmd3.color;
								}
							});
							if (Serv.infos.color && cmd2.setcolor.value == Serv.infos.color.id) {
								Serv.actions.setcolor=cmd2.setcolor;
							}
						} else if (cmd2.setcolor_temp) {
							eqServicesCopy.light.forEach(function(cmd3) {
								if (cmd3.color_temp) {
									Serv.infos.color_temp=cmd3.color_temp;
								}
							});
							if (Serv.infos.color_temp.id && cmd2.setcolor_temp.value == Serv.infos.color_temp.id) {
								Serv.actions.setcolor_temp=cmd2.setcolor_temp;
							}
						}
					});
					if (Serv.actions.on && !Serv.actions.off) that.log('warn','Pas de type générique "Action/Lumière OFF" ou reférence à l\'état non définie sur la commande OFF'); 
					if (!Serv.actions.on && Serv.actions.off) that.log('warn','Pas de type générique "Action/Lumière ON" ou reférence à l\'état non définie sur la commande ON');
					if (!Serv.actions.on && !Serv.actions.off) that.log('warn','Pas de type générique "Action/Lumière ON" et "Action/Lumière OFF" ou reférence à l\'état non définie sur la commande ON et OFF');
					if (Serv.infos.color && !Serv.actions.setcolor) that.log('warn','Pas de type générique "Action/Lumière Couleur" ou la référence à l\'état de l\'info non définie sur l\'action');
					if (!Serv.infos.color && Serv.actions.setcolor) that.log('warn','Pas de type générique "Info/Lumière Couleur"');
					if (Serv.infos.color_temp && !Serv.actions.setcolor_temp) that.log('warn','Pas de type générique "Action/Lumière Température Couleur" ou la référence à l\'état de l\'info non définie sur l\'action');
					if (!Serv.infos.color_temp && Serv.actions.setcolor_temp) that.log('warn','Pas de type générique "Info/Lumière Température Couleur"');
					
					if(Serv.actions.slider) {
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.maxValue && parseInt(Serv.actions.slider.configuration.maxValue))
							maxBright = parseInt(Serv.actions.slider.configuration.maxValue);
						else
							maxBright = 100; // if not set in Jeedom it's 100
						LightType += "_Slider";
						HBservice.characteristics.push(Characteristic.Brightness);
						Serv.addCharacteristic(Characteristic.Brightness);
					} else {
						that.log('info','La lumière n\'a pas de variateur');
					}
					if(Serv.infos.color) {
						LightType += "_RGB";
						HBservice.characteristics.push(Characteristic.Hue);
						Serv.addCharacteristic(Characteristic.Hue);
						HBservice.characteristics.push(Characteristic.Saturation);
						Serv.addCharacteristic(Characteristic.Saturation);
						Serv.HSBValue = {
							hue : 0,
							saturation : 0,
							brightness : 0
						};
						Serv.RGBValue = {
							red : 0,
							green : 0,
							blue : 0
						};
						//Serv.countColorCharacteristics = 0;
						Serv.timeoutIdColorCharacteristics = 0;
					}
					if(Serv.infos.color_temp) {
						LightType += "_Temp";
						var props = {};
						if(Serv.actions.setcolor_temp.configuration && Serv.actions.setcolor_temp.configuration.minValue && parseInt(Serv.actions.setcolor_temp.configuration.minValue))
							props.minValue = parseInt(Serv.actions.setcolor_temp.configuration.minValue);
						else
							props.minValue = 0; // if not set in Jeedom it's 0
						if(Serv.actions.setcolor_temp.configuration && Serv.actions.setcolor_temp.configuration.maxValue && parseInt(Serv.actions.setcolor_temp.configuration.maxValue))
							props.maxValue = parseInt(Serv.actions.setcolor_temp.configuration.maxValue);
						else
							props.maxValue = 100; // if not set in Jeedom it's 100
						
						var unite = Serv.infos.color_temp.unite ? Serv.infos.color_temp.unite : '';
						if(unite) props.unit=unite;
						HBservice.characteristics.push(Characteristic.ColorTemperature);
						Serv.addCharacteristic(Characteristic.ColorTemperature);
						Serv.getCharacteristic(Characteristic.ColorTemperature).setProps(props);
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					that.log('info','La lumière est du type :',LightType+','+maxBright);
					Serv.LightType = LightType;
					Serv.maxBright = maxBright;
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Lumière Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.flap) {
			eqLogic.services.flap.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.WindowCovering(eqLogic.name),
						characteristics : [Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;

					eqServicesCopy.flap.forEach(function(cmd2) {
						if (cmd2.up) {
							if (cmd2.up.value == cmd.state.id) {
								Serv.actions.up = cmd2.up;
							}
						} else if (cmd2.down) {
							if (cmd2.down.value == cmd.state.id) {
								Serv.actions.down = cmd2.down;
							}
						} else if (cmd2.slider) {
							if (cmd2.slider.value == cmd.state.id) {
								Serv.actions.slider = cmd2.slider;
							}
						}
					});
					if (Serv.actions.up && !Serv.actions.down) that.log('warn','Pas de type générique "Action/Volet Bouton Descendre" ou reférence à l\'état non définie sur la commande Down'); 
					if (!Serv.actions.up && Serv.actions.down) that.log('warn','Pas de type générique "Action/Volet Bouton Monter" ou reférence à l\'état non définie sur la commande Up');
					if(!Serv.actions.up && !Serv.actions.down && !Serv.actions.slider) that.log('warn','Pas de type générique "Action/Volet Bouton Slider" ou "Action/Volet Bouton Monter" et "Action/Volet Bouton Descendre" ou reférence à l\'état non définie sur la commande Slider');
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;

					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Volet Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.energy) {
			eqLogic.services.energy.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.Switch(eqLogic.name),
						characteristics : [Characteristic.On]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.energy.forEach(function(cmd2) {
						if (cmd2.on) {
							if (cmd2.on.value == cmd.state.id) {
								Serv.actions.on = cmd2.on;
							}
						} else if (cmd2.off) {
							if (cmd2.off.value == cmd.state.id) {
								Serv.actions.off = cmd2.off;
							}
						}
					});
					if(!Serv.actions.on) that.log('warn','Pas de type générique "Action/Prise Bouton On" ou reférence à l\'état non définie sur la commande On');
					if(!Serv.actions.off) that.log('warn','Pas de type générique "Action/Prise Bouton Off" ou reférence à l\'état non définie sur la commande Off');
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Prise Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.power || (eqLogic.services.power && eqLogic.services.consumption)) {
			eqLogic.services.power.forEach(function(cmd) {
				if (cmd.power) {
					HBservice = {
						controlService : new Service.PowerMonitor(eqLogic.name),
						characteristics : [Characteristic.CurrentPowerConsumption, Characteristic.TotalPowerConsumption]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.power=cmd.power;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					if(eqServicesCopy.consumption) {
						eqServicesCopy.consumption.forEach(function(cmd2) {
							if (cmd2.consumption) {
								Serv.infos.consumption=cmd2.consumption;
							}
						});
					}
					
					Serv.cmd_id = cmd.power.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.battery) {
			eqLogic.services.battery.forEach(function(cmd) {
				if (cmd.battery) {
					HBservice = {
						controlService : new Service.BatteryService(eqLogic.name),
						characteristics : [Characteristic.BatteryLevel,Characteristic.ChargingState,Characteristic.StatusLowBattery]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.battery=cmd.battery;
					Serv.infos.batteryCharging=cmd.batteryCharging || {id:'NOT'};
					Serv.cmd_id = cmd.battery.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.presence) {
			eqLogic.services.presence.forEach(function(cmd) {
				if (cmd.presence) {
					HBservice = {
						controlService : new Service.MotionSensor(eqLogic.name),
						characteristics : [Characteristic.MotionDetected]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.presence=cmd.presence;
					Serv.invertBinary=cmd.presence.display.invertBinary;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);

					Serv.cmd_id = cmd.presence.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.generic) {
			eqLogic.services.generic.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.CustomService(eqLogic.name),
						characteristics : []
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					var props = {};
					var unite = '';
					if(cmd.state.subType=="numeric") {
						that.log('debug','Le générique',cmd.state.name,'est un numérique');
						// test if default value is Float or Int ?
						var CharactToSet=Characteristic.GenericFLOAT;
						var NumericGenericType='float';
						if(cmd.state.currentValue.toString().indexOf('.') == -1) {
							CharactToSet=Characteristic.GenericINT;
							NumericGenericType='int';
						}
						that.log('debug','Sur base de sa valeur actuelle',cmd.state.currentValue,', on determine un type :',NumericGenericType);
						HBservice.characteristics.push(CharactToSet);
						Serv.addCharacteristic(CharactToSet);
						Serv.getCharacteristic(CharactToSet).displayName = cmd.state.name;
						
						unite = cmd.state.unite ? cmd.state.unite : '';
						if(unite) props.unit=unite;
						if(cmd.state.configuration) {
							if(NumericGenericType=='float'){
								if(cmd.state.configuration.maxValue != null && cmd.state.configuration.maxValue != undefined && cmd.state.configuration.maxValue != "") props.maxValue = parseFloat(cmd.state.configuration.maxValue);
								if(cmd.state.configuration.minValue != null && cmd.state.configuration.minValue != undefined && cmd.state.configuration.minValue != "") props.minValue = parseFloat(cmd.state.configuration.minValue);
							} else if (NumericGenericType=='int'){
								if(cmd.state.configuration.maxValue != null && cmd.state.configuration.maxValue != undefined && cmd.state.configuration.maxValue != "") props.maxValue = parseInt(cmd.state.configuration.maxValue);
								if(cmd.state.configuration.minValue != null && cmd.state.configuration.minValue != undefined && cmd.state.configuration.minValue != "") props.minValue = parseInt(cmd.state.configuration.minValue);
							}
						}
						if(Object.keys(props).length !== 0) {
							that.log('debug','On lui set les props suivants :',props);
							Serv.getCharacteristic(CharactToSet).setProps(props);
						}
					} else if (cmd.state.subType=="binary") {
						that.log('debug','Le générique',cmd.state.name,'est un booléen');
						HBservice.characteristics.push(Characteristic.GenericBOOL);
						Serv.addCharacteristic(Characteristic.GenericBOOL);
						Serv.getCharacteristic(Characteristic.GenericBOOL).displayName = cmd.state.name;
					} else if (cmd.state.subType=="string") {
						that.log('debug','Le générique',cmd.state.name,'est une chaîne');
						HBservice.characteristics.push(Characteristic.GenericSTRING);
						Serv.addCharacteristic(Characteristic.GenericSTRING);
						Serv.getCharacteristic(Characteristic.GenericSTRING).displayName = cmd.state.name;
						
						unite = cmd.state.unite ? cmd.state.unite : '';
						if(unite) props.unit=unite;
						if(Object.keys(props).length !== 0) {
							that.log('debug','On lui set les props suivants :',props);
							Serv.getCharacteristic(Characteristic.GenericSTRING).setProps(props);
						}
					}					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id +'-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.uv) {
			eqLogic.services.uv.forEach(function(cmd) {
				if (cmd.uv) {
					HBservice = {
						controlService : new Service.TemperatureSensor(eqLogic.name),
						characteristics : [Characteristic.UVIndex]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.uv=cmd.uv;
					Serv.cmd_id = cmd.uv.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}			
		if (eqLogic.services.speaker) {
			eqLogic.services.speaker.forEach(function(cmd) {
				if (cmd.mute) {
					HBservice = {
						controlService : new Service.Speaker(eqLogic.name),
						characteristics : [Characteristic.Mute]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.mute=cmd.mute;
					eqServicesCopy.speaker.forEach(function(cmd2) {
						if (cmd2.mute_toggle) {
							if (cmd2.mute_toggle.value == cmd.mute.id) {
								Serv.actions.mute_toggle = cmd2.mute_toggle;
							}
						} else if (cmd2.mute_on) {
							if (cmd2.mute_on.value == cmd.mute.id) {
								Serv.actions.mute_on = cmd2.mute_on;
							}
						} else if (cmd2.mute_off) {
							if (cmd2.mute_off.value == cmd.mute.id) {
								Serv.actions.mute_off = cmd2.mute_off;
							}
						} else if (cmd2.set_volume) {
							eqServicesCopy.speaker.forEach(function(cmd3) {
								if (cmd3.volume) {
									Serv.infos.volume=cmd3.volume;
								}
							});
							if (Serv.infos.volume && cmd2.set_volume.value == Serv.infos.volume.id) {
								HBservice.characteristics.push(Characteristic.Volume);
								Serv.addCharacteristic(Characteristic.Volume);
								Serv.actions.set_volume = cmd2.set_volume;
							}
						}
					});
					if(!Serv.actions.set_volume) that.log('warn','Pas de type générique "Action/Haut-Parleur Volume" ou reférence à l\'état "Info/Haut-Parleur Volume" non définie sur la commande "Action/Haut-Parleur Volume" ou pas de type génériqe "Info/Haut-Parleur Volume"');
					if(!Serv.actions.mute_toggle && !Serv.actions.mute_on && Serv.actions.mute_off) that.log('warn','Pas de type générique "Action/Haut-Parleur Mute" ou reférence à l\'état "Info/Haut-Parleur Mute" non définie sur la commande "Action/Haut-Parleur Mute"');	
					if(!Serv.actions.mute_toggle && Serv.actions.mute_on && !Serv.actions.mute_off) that.log('warn','Pas de type générique "Action/Haut-Parleur UnMute" ou reférence à l\'état "Info/Haut-Parleur Mute" non définie sur la commande "Action/Haut-Parleur UnMute"');	
					if(!Serv.actions.mute_toggle && !Serv.actions.mute_on && !Serv.actions.mute_off) that.log('warn','Pas de type générique "Action/Haut-Parleur Toggle Mute" / "Action/Haut-Parleur Mute" / "Action/Haut-Parleur UnMute" ou reférence à l\'état "Info/Haut-Parleur Mute" non définie sur ces commande');	
					Serv.cmd_id = cmd.mute.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Haut-Parleur Mute"');
			} else {
				HBservice = null;
			}
		}			
		if (eqLogic.services.temperature) {
			eqLogic.services.temperature.forEach(function(cmd) {
				if (cmd.temperature) {
					HBservice = {
						controlService : new Service.TemperatureSensor(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.temperature=cmd.temperature;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.temperature.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});

		}
		if (eqLogic.services.humidity) {
			eqLogic.services.humidity.forEach(function(cmd) {
				if (cmd.humidity) {
					HBservice = {
						controlService : new Service.HumiditySensor(eqLogic.name),
						characteristics : [Characteristic.CurrentRelativeHumidity]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.humidity=cmd.humidity;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.humidity.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.smoke) {
			eqLogic.services.smoke.forEach(function(cmd) {
				if (cmd.smoke) {
					HBservice = {
						controlService : new Service.SmokeSensor(eqLogic.name),
						characteristics : [Characteristic.SmokeDetected]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.smoke=cmd.smoke;
					Serv.invertBinary=cmd.smoke.display.invertBinary;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.smoke.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.flood) {
			eqLogic.services.flood.forEach(function(cmd) {
				if (cmd.flood) {
					HBservice = {
						controlService : new Service.LeakSensor(eqLogic.name),
						characteristics : [Characteristic.LeakDetected]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.flood=cmd.flood;
					Serv.invertBinary=cmd.flood.display.invertBinary;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.flood.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.opening) {
			eqLogic.services.opening.forEach(function(cmd) {
				if (cmd.opening) {
					HBservice = {
						controlService : new Service.ContactSensor(eqLogic.name),
						characteristics : [Characteristic.ContactSensorState]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.opening=cmd.opening;
					Serv.invertBinary=cmd.opening.display.invertBinary;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.opening.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.brightness) {
			eqLogic.services.brightness.forEach(function(cmd) {
				if (cmd.brightness) {
					HBservice = {
						controlService : new Service.LightSensor(eqLogic.name),
						characteristics : [Characteristic.CurrentAmbientLightLevel]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.brightness=cmd.brightness;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.brightness.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.energy2) { // not used
			eqLogic.services.energy2.forEach(function(cmd) {
				if (cmd.energy2) {
					HBservice = {
						controlService : new Service.Outlet(eqLogic.name),
						characteristics : [Characteristic.On, Characteristic.OutletInUse]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.energy2=cmd.energy2;
					Serv.cmd_id = cmd.energy2.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.GarageDoor) {
			eqLogic.services.GarageDoor.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.GarageDoorOpener(eqLogic.name),
						characteristics : [Characteristic.CurrentDoorState, Characteristic.TargetDoorState]//, Characteristic.ObstructionDetected]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.GarageDoor.forEach(function(cmd2) {
						if (cmd2.on) {
							if (cmd2.on.value == cmd.state.id) {
								Serv.actions.on = cmd2.on;
							}
						} else if (cmd2.off) {
							if (cmd2.off.value == cmd.state.id) {
								Serv.actions.off = cmd2.off;
							}
						} else if (cmd2.toggle) {
							if (cmd2.toggle.value == cmd.state.id) {
								Serv.actions.toggle = cmd2.toggle;
							}
						}
					});
					if(!Serv.actions.toggle) that.log('warn','Pas de type générique "Action/Portail ou garage bouton toggle" ou reférence à l\'état non définie sur la commande Toggle');
					
					if(eqLogic.customValues) {
						Serv.customValues = eqLogic.customValues;
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Garage état ouvrant" ou "Info/Portail état ouvrant"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.lock) {
			eqLogic.services.lock.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.LockMechanism(eqLogic.name),
						characteristics : [Characteristic.LockCurrentState, Characteristic.LockTargetState]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.lock.forEach(function(cmd2) {
						if (cmd2.on) {
							if (cmd2.on.value == cmd.state.id) {
								Serv.actions.on = cmd2.on;
							}
						} else if (cmd2.off) {
							if (cmd2.off.value == cmd.state.id) {
								Serv.actions.off = cmd2.off;
							}
						}
					});
					if(!Serv.actions.on) that.log('warn','Pas de type générique "Action/Serrure Bouton Ouvrir" ou reférence à l\'état non définie sur la commande Ouvrir');
					if(!Serv.actions.off) that.log('warn','Pas de type générique "Action/Serrure Bouton Fermer" ou reférence à l\'état non définie sur la commande Fermer');
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Serrure Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.DoorBell) {
			eqLogic.services.DoorBell.forEach(function(cmd) {
				if(cmd.state) {
					HBservice = {
						controlService : new Service.Doorbell(eqLogic.name),
						characteristics : [Characteristic.ProgrammableSwitchEvent]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.thermostat) {
			eqLogic.services.thermostat.forEach(function(cmd) {
				if(cmd.setpoint) {
					HBservice = {
						controlService : new Service.Thermostat(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature, Characteristic.TargetTemperature, Characteristic.CurrentHeatingCoolingState, Characteristic.TargetHeatingCoolingState]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.setpoint=cmd.setpoint;
					Serv.thermo={};
					eqServicesCopy.thermostat.forEach(function(cmd2) {
						if (cmd2.state_name) {
							Serv.infos.state_name=cmd2.state_name;
							HBservice.characteristics.push(Characteristic.GenericSTRING);
							Serv.addCharacteristic(Characteristic.GenericSTRING);
							Serv.getCharacteristic(Characteristic.GenericSTRING).displayName = cmd2.state_name.name;
						} else if (cmd2.lock) {
							Serv.infos.lock=cmd2.lock;
							HBservice.characteristics.push(Characteristic.LockPhysicalControls);
							Serv.addCharacteristic(Characteristic.LockPhysicalControls);
							Serv.getCharacteristic(Characteristic.LockPhysicalControls).displayName = cmd2.lock.name;
						} else if (cmd2.mode) {
							Serv.infos.mode=cmd2.mode;
						} else if (cmd2.temperature) {
							Serv.infos.temperature=cmd2.temperature;
						} else if (cmd2.state) {
							Serv.infos.state=cmd2.state;
						} else if (cmd2.set_lock) {
							Serv.actions.set_lock=cmd2.set_lock;
						} else if (cmd2.set_unlock) {
							Serv.actions.set_unlock=cmd2.set_unlock;
						}
					});
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);	

					if(eqLogic.thermoModes) {
						if(eqLogic.thermoModes.Chauf && eqLogic.thermoModes.Chauf != "NOT") {
							Serv.thermo.chauf = {};
							let splitted = eqLogic.thermoModes.Chauf.split('|');
							Serv.thermo.chauf.mode_label = splitted[1];
							Serv.thermo.chauf.mode_id = splitted[0];
						}
						else
							that.log('warn','Pas de config du mode Chauffage');
						if(eqLogic.thermoModes.Clim && eqLogic.thermoModes.Clim != "NOT") {
							Serv.thermo.clim = {};
							let splitted = eqLogic.thermoModes.Clim.split('|');
							Serv.thermo.clim.mode_label = splitted[1];
							Serv.thermo.clim.mode_id = splitted[0];
						}
						else
							that.log('warn','Pas de config du mode Climatisation');
						if(eqLogic.thermoModes.Off && eqLogic.thermoModes.Off != "NOT") {
							Serv.thermo.off = {};
							let splitted = eqLogic.thermoModes.Off.split('|');
							Serv.thermo.off.mode_label = splitted[1];
							Serv.thermo.off.mode_id = splitted[0];
						}
					}
					else {
						if(that.myPlugin == "homebridge")
							that.log('warn','Pas de config des modes du thermostat');
					}
					Serv.cmd_id = cmd.setpoint.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.alarm) {
			eqLogic.services.alarm.forEach(function(cmd) {
				if(cmd.enable_state) {
					HBservice = {
						controlService : new Service.SecuritySystem(eqLogic.name),
						characteristics : [Characteristic.SecuritySystemCurrentState, Characteristic.SecuritySystemTargetState]
					};
					let Serv = HBservice.controlService;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.enable_state=cmd.enable_state;
					Serv.alarm={};
					eqServicesCopy.alarm.forEach(function(cmd2) {
						if (cmd2.state) {
							if (cmd2.state.eqLogic_id == eqLogic.id) { // no value link, so using eqLogic id as there is only one alarm per eqlogic
								Serv.infos.state=cmd2.state;
							}
						} else if (cmd2.mode) {
							if (cmd2.mode.eqLogic_id == eqLogic.id) { // no value link, so using eqLogic id as there is only one alarm per eqlogic
								Serv.infos.mode=cmd2.mode;
							}
						}
					});
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);

					var away_mode_id,away_mode_label,present_mode_label,present_mode_id,night_mode_label,night_mode_id;
					if(eqLogic.alarmModes) {
						if(eqLogic.alarmModes.SetModeAbsent && eqLogic.alarmModes.SetModeAbsent != "NOT") {
							Serv.alarm.away = {};
							let splitted = eqLogic.alarmModes.SetModeAbsent.split('|');
							away_mode_label = splitted[1];
							Serv.alarm.away.mode_label = splitted[1];
							away_mode_id = splitted[0];
							Serv.alarm.away.mode_id = splitted[0];
						}
						else
							that.log('warn','Pas de config du mode À distance/Absence');
						if(eqLogic.alarmModes.SetModePresent && eqLogic.alarmModes.SetModePresent != "NOT") {
							Serv.alarm.present = {};
							let splitted = eqLogic.alarmModes.SetModePresent.split('|');
							present_mode_label = splitted[1];
							Serv.alarm.present.mode_label = splitted[1];
							present_mode_id = splitted[0];
							Serv.alarm.present.mode_id = splitted[0];
						}
						else
							that.log('warn','Pas de config du mode Domicile/Présence');
						if(eqLogic.alarmModes.SetModeNuit && eqLogic.alarmModes.SetModeNuit != "NOT") {
							Serv.alarm.night = {};
							let splitted = eqLogic.alarmModes.SetModeNuit.split('|');
							night_mode_label = splitted[1];
							Serv.alarm.night.mode_label = splitted[1];
							night_mode_id = splitted[0];
							Serv.alarm.night.mode_id = splitted[0];
						}
						else
							that.log('warn','Pas de config du mode Nuit');
					}
					else {
						if(that.myPlugin == "homebridge")
							that.log('warn','Pas de config des modes de l\'alarme');
					}
					Serv.cmd_id = cmd.enable_state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}

		if (HBservices.length != 0) {
			createdAccessory = that.createAccessory(HBservices, eqLogic);
			that.addAccessory(createdAccessory);
			HBservices = [];
		}
		else
		{
			that.log('│ Accessoire sans Type Générique');
			createdAccessory = that.createAccessory([], eqLogic); // create a cached lookalike object for unregistering it
			that.delAccessory(createdAccessory);
		}
		that.log('└─────────');
	}
	catch(e){
		this.log('error','Erreur de la fonction AccessoireCreateHomebridge :',e);
		console.error(e.stack);
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [this.existingAccessory(createdAccessory.UUID,true)]);
		hasError=true;
	}		
};

// -- createStatusCharact
// -- Desc : Create StatusTampered, StatusFault and StatusActive Characteristics if exists
// -- Params --
// -- HBservice : translated homebridge service
// -- eqLogic : the jeedom eqLogic
JeedomPlatform.prototype.createStatusCharact = function(HBservice,services) {
	let Serv = HBservice.controlService;
	Serv.statusArr = {};
	var sabotage,defect,status_active;
	if(services.sabotage) {
		for(let s in services.sabotage) { if(services.sabotage[s] !== null) {sabotage=services.sabotage[s];break;} }
		if(sabotage) {
			HBservice.characteristics.push(Characteristic.StatusTampered);
			Serv.addCharacteristic(Characteristic.StatusTampered);
			Serv.statusArr.sabotage =sabotage.sabotage;
			Serv.sabotageInverted = 0;
			if(sabotage.sabotage.display)
				Serv.sabotageInverted = sabotage.sabotage.display.invertBinary;
		}
	}
	if(services.defect) {
		for(let s in services.defect) { if(services.defect[s] !== null) {defect=services.defect[s]; break;} }
		if(defect) {
			HBservice.characteristics.push(Characteristic.StatusFault);
			Serv.addCharacteristic(Characteristic.StatusFault);
			Serv.statusArr.defect=defect.defect;
		}
	}
	if(services.status_active) {
		for(let s in services.status_active) { if(services.status_active[s] !== null) {status_active=services.status_active[s]; break;} }
		if(status_active) {
			HBservice.characteristics.push(Characteristic.StatusActive);
			Serv.addCharacteristic(Characteristic.StatusActive);
			Serv.statusArr.status_active=status_active.status_active;
		}
	}
	return HBservice;
};

// -- createAccessory
// -- Desc : Create the JeedomBridgedAccessory object
// -- Params --
// -- HBservices : translated homebridge services
// -- eqLogic : the jeedom eqLogic
JeedomPlatform.prototype.createAccessory = function(HBservices, eqLogic) {
	try{
		
		var accessory = new JeedomBridgedAccessory(HBservices);
		accessory.platform = this;
		accessory.log = this.log;
		accessory.name = eqLogic.name;

		accessory.UUID = UUIDGen.generate(eqLogic.id + accessory.name);
		accessory.context = {};
		accessory.context.uniqueSeed = eqLogic.id + accessory.name;
		accessory.context.eqLogic = eqLogic;
		
		accessory.model = eqLogic.eqType_name;
		accessory.manufacturer = 'Jeedom>'+ this.rooms[eqLogic.object_id] +'>'+accessory.name;
		accessory.serialNumber = '<'+eqLogic.id+'-'+eqLogic.logicalId+'>';
		accessory.services_add = HBservices;
		return accessory;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction createAccessory :',e);
		console.error(e.stack);
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
	var existingAccessory;
	try{
		silence = silence || false;
		if (!jeedomAccessory) {
			return;
		}

		if(!silence) this.log('│ Vérification d\'existance de l\'accessoire dans le cache Homebridge...');
		existingAccessory = this.existingAccessory(jeedomAccessory.UUID,silence);
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
		this.log('error','│ Erreur de la fonction delAccessory :',e);
		console.error(e.stack);
		// force to unregister the accessory before quitting (avoid cache or persist corruption)
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [existingAccessory]);
		hasError=true;
	}
};

// -- addAccessory
// -- Desc : adding or updating an Accessory to homebridge and local list
// -- Params --
// -- jeedomAccessory : JeedomBridgedAccessory to add
// -- Return : nothing
JeedomPlatform.prototype.addAccessory = function(jeedomAccessory) {
	var HBAccessory;
	try{
		if (!jeedomAccessory) {
			return;
		}
		let isNewAccessory = false;
		let services2Add = jeedomAccessory.services_add;
		this.log('│ Vérification d\'existance de l\'accessoire dans le cache Homebridge...');
		HBAccessory = this.existingAccessory(jeedomAccessory.UUID);
		if (!HBAccessory) {
			this.log('│ Nouvel accessoire (' + jeedomAccessory.name + ')');
			isNewAccessory = true;
			HBAccessory = new Accessory(jeedomAccessory.name, jeedomAccessory.UUID);
			jeedomAccessory.initAccessory(HBAccessory);
			this.accessories[jeedomAccessory.UUID] = HBAccessory;
		}
		HBAccessory.context = jeedomAccessory.context;
		//No more supported by HAP-NodeJS
		//HBAccessory.reachable = true;
		//HBAccessory.updateReachability(true);
		
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
			this.log(HBAccessory.displayName, "->Identifié!!!");
			callback();
		}.bind(this));
		HBAccessory.reviewed = true;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction addAccessory :',e);
		console.error(e.stack);
		// unregister the accessory before quitting (avoid cache or persist corruption)
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [HBAccessory]);
		hasError=true;
	}
};

// -- existingAccessory
// -- Desc : check if the accessory exists in the local list
// -- Params --
// -- UUID : UUID to find
// -- silence : flag for logging or not
// -- Return : nothing
JeedomPlatform.prototype.existingAccessory = function(UUID,silence) {
	try{
		silence = silence || false;
		for (var a in this.accessories) {
			if (this.accessories.hasOwnProperty(a)) {
				if (this.accessories[a].UUID == UUID) {
					if(!silence) this.log('│ Accessoire déjà existant dans le cache Homebridge');
					return this.accessories[a];
				}
			}
		}
		if(!silence) this.log('│ Accessoire non existant dans le cache Homebridge');
		return null;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction existingAccessory :',e);	
		console.error(e.stack);
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
		//this.log('debug',JSON.stringify(accessory).replace("\n",""));
		if(!accessory.context)// || !accessory.context.eqLogic)
		{
			// Remove this invalid device from the cache.
			this.log('debug','L\'accessoire est invalide, on le retire du cache Homebridge :',accessory.displayName);
			try {
				this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [accessory]);
			} catch (e) {
				this.log('error',"#45 Impossible de supprimer l'accessoire !" , e);
			}
			return;
		}
		
		for (var s = 0; s < accessory.services.length; s++) {
			var service = accessory.services[s];
			for (var i = 0; i < service.characteristics.length; i++) {
				var characteristic = service.characteristics[i];
				if (characteristic.props.needsBinding)
					this.bindCharacteristicEvents(characteristic, service);
			}
		}
		this.log('Accessoire en cache: ' + accessory.displayName);
		this.accessories[accessory.UUID] = accessory;
		//accessory.reachable = true;
	}
	catch(e){
		this.log('error','Erreur de la fonction configureAccessory :',e);
		console.error(e.stack);
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

		this.subscribeUpdate(service, characteristic);
		if (!readOnly) {
			characteristic.on('set', function(value, callback, context) {
				if (context !== 'fromJeedom' && context !== 'fromSetValue') { // from Homekit
					this.log('info','[Commande d\'Homekit]','Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+characteristic.value+'->'+value,'\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
					this.setAccessoryValue(value,characteristic,service);
				} else
					this.log('info','[Commande de Jeedom]','Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+value,'\t\t\t\t\t|||context:'+JSON.stringify(context),'characteristic:'+JSON.stringify(characteristic));
				callback();
			}.bind(this));
		}
		characteristic.on('get', function(callback) {
			let returnValue = sanitizeValue(this.getAccessoryValue(characteristic, service),characteristic);
			this.log('info','[Demande d\'Homekit]','Nom:'+service.displayName+'>'+characteristic.displayName+'='+characteristic.value,'('+returnValue+')','\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
			callback(undefined, returnValue);
		}.bind(this));
	}
	catch(e){
		this.log('error','Erreur de la fonction bindCharacteristicEvents :',e);
		console.error(e.stack);
		hasError=true;
	}
};

// -- setAccessoryValue
// -- Desc : set the value of an accessory in Jeedom
// -- Params --
// -- value : the value to set
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- Return : nothing
JeedomPlatform.prototype.setAccessoryValue = function(value, characteristic, service) {
	try{
		//var that = this;
		
		var action,rgb;
		switch (characteristic.UUID) {
			case Characteristic.On.UUID :
			case Characteristic.Mute.UUID :
			case Characteristic.LockPhysicalControls.UUID :
				this.command(value == 0 ? 'turnOff' : 'turnOn', null, service);
			break;
			case Characteristic.TargetTemperature.UUID :
				if (Math.abs(value - characteristic.value) >= 0.5) {
					value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
					this.command('setTargetLevel', value, service);
				} else {
					value = characteristic.value;
				}
				setTimeout(function() {
					characteristic.setValue(sanitizeValue(value,characteristic), undefined, 'fromSetValue');
				}, 100);
			break;
			case Characteristic.TimeInterval.UUID :
				this.command('setTime', value + Math.trunc((new Date()).getTime() / 1000), service);
			break;
			case Characteristic.TargetHeatingCoolingState.UUID :
				this.log('debug','set target mode:',value);
				this.command('TargetHeatingCoolingState', value, service);
			break;
			case Characteristic.TargetDoorState.UUID :
				this.command('GBtoggle', 0, service);
			break;
			case Characteristic.LockTargetState.UUID :
				action = value == Characteristic.LockTargetState.UNSECURED ? 'unsecure' : 'secure';
				this.command(action, 0, service);
			break;
			case Characteristic.SecuritySystemTargetState.UUID:
				this.command('SetAlarmMode', value, service);
			break;
			case Characteristic.CurrentPosition.UUID:
			case Characteristic.TargetPosition.UUID:
			case Characteristic.PositionState.UUID: // could be Service.Window or Service.Door too so we check
				if (service.UUID == Service.WindowCovering.UUID) {
					if(service.actions.down && service.actions.up) {
						if (service.actions.slider) {
							if (value == 0)
								action = 'flapDown';
							else if (value == 99 || value == 100)
								action = 'flapUp';
							else
								action = 'setValue';
						}
						else {
							if (value < 50)
								action = 'flapDown';
							else
								action = 'flapUp';
						}
					}
					else if (service.actions.slider) {
						action = 'setValue';
					}

					this.command(action, value, service);
				}
			break;
			case Characteristic.ColorTemperature.UUID :
				this.log('debug',"ColorTemperature set : ",value);
				this.command('setValueTemp', value, service);
			break;
			case Characteristic.Hue.UUID :
				this.log('debug',"Hue set : ",value);
				//this.command("setValue",value,service);
				rgb = this.updateJeedomColorFromHomeKit(value, null, null, service);
				this.syncColorCharacteristics(rgb, service);
			break;
			case Characteristic.Saturation.UUID :
				this.log('debug',"Sat set : ",value);
				//this.command("setValue",value,service);
				rgb = this.updateJeedomColorFromHomeKit(null, value, null, service);
				this.syncColorCharacteristics(rgb, service);
			break;
			case Characteristic.Brightness.UUID :
				this.settingLight=true;
				clearTimeout(this.temporizator);
				let maxJeedom = parseInt(service.maxBright) || 100;
				value = parseInt(value);
				let oldValue=value;
				if(maxJeedom) {
					value = Math.round((value / 100)*maxJeedom);
				}
				this.log('debug','---------set Bright:',oldValue,'% soit',value,' / ',maxJeedom);
				this.command('setValue', value, service);
			break;
			default :
				this.command('setValue', value, service);
			break;
		}
	
	}
	catch(e){
		this.log('error','Erreur de la fonction setAccessoryValue :',e);
		console.error(e.stack);
	}
};

// -- getAccessoryValue
// -- Desc : Get the value of an accessory in the jeedom local cache
// -- Params --
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- Return : nothing
JeedomPlatform.prototype.getAccessoryValue = function(characteristic, service) {
	try{
		var that = this;
		
		var customValues=[];
		if(service.customValues) {
			customValues=service.customValues;
		} else {
			customValues={'OPEN':255,'OPENING':254,'STOPPED':253,'CLOSING':252,'CLOSED':0};
		}
		var returnValue = 0;
		var HRreturnValue;
		var cmdList = that.jeedomClient.getDeviceCmd(service.eqID);
		var hsv,mode_PRESENT,mode_AWAY,mode_NIGHT,mode_CLIM,mode_CHAUF;
		switch (characteristic.UUID) {
			// Switch or Light
			case Characteristic.On.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_STATE' && cmd.id == service.cmd_id) {
						if(parseInt(cmd.currentValue) == 0) returnValue=false;
						else returnValue=true;
						break;
					}
					if (cmd.generic_type == 'LIGHT_STATE_BOOL' && cmd.id == service.infos.state_bool.id) {
						if(parseInt(cmd.currentValue) == 0) returnValue=false;
						else returnValue=true;
						break;
					}
					if (cmd.generic_type == "ENERGY_STATE" && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.LockPhysicalControls.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_LOCK' && cmd.id == service.infos.lock.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			// Generics
			case Characteristic.ContactSensorState.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'OPENING' || cmd.generic_type == 'OPENING_WINDOW') && cmd.id == service.cmd_id) {
						returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ?
						if(returnValue === false) returnValue = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
						else returnValue = Characteristic.ContactSensorState.CONTACT_DETECTED;
						break;
					}
				}
			break;
			case Characteristic.CurrentAmbientLightLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BRIGHTNESS' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.CurrentRelativeHumidity.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'HUMIDITY' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.CurrentTemperature.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'TEMPERATURE' && cmd.id == service.cmd_id) || 
					    (cmd.generic_type == 'THERMOSTAT_TEMPERATURE' && cmd.id == service.infos.temperature.id)) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.LeakDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLOOD' && cmd.id == service.cmd_id) {
						//returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) returnValue = Characteristic.LeakDetected.LEAK_NOT_DETECTED;
						else returnValue = Characteristic.LeakDetected.LEAK_DETECTED;
						break;
					}
				}
			break;
			case Characteristic.MotionDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'PRESENCE' && cmd.id == service.cmd_id) {
						//returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert ?
						returnValue = toBool(cmd.currentValue);
						break;
					}
				}
			break;			
			case Characteristic.SmokeDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SMOKE' && cmd.id == service.cmd_id) {
						//returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) returnValue = Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
						else returnValue = Characteristic.SmokeDetected.SMOKE_DETECTED;						
						break;
					}
				}
			break;
			case Characteristic.UVIndex.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'UV' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;				
			//Generic_info
			case Characteristic.GenericFLOAT.UUID :
			case Characteristic.GenericINT.UUID :
			case Characteristic.GenericBOOL.UUID :
				for (const cmd of cmdList) {
					if (GenericAssociated.indexOf(cmd.generic_type) != -1 && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.GenericSTRING.UUID :
				let maxSize = 64;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_STATE_NAME' && cmd.id == service.infos.state_name.id) {
						returnValue = cmd.currentValue.toString().substring(0,maxSize);
						break;
					} else if (GenericAssociated.indexOf(cmd.generic_type) != -1 && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue.toString().substring(0,maxSize);
						break;
					}
				}
			break;
			// Lights
			case Characteristic.Hue.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
						returnValue = cmd.currentValue;
						break;
					}
				}
				hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.h);
			break;
			case Characteristic.Saturation.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
						returnValue = cmd.currentValue;
						break;
					}
				}
				hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.v);
			break;
			case Characteristic.ColorTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR_TEMP') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.Brightness.UUID :
				returnValue = 0;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_STATE' && cmd.subType != 'binary' && cmd.id == service.cmd_id) {
						let maxJeedom = parseInt(service.maxBright) || 100;
						returnValue = parseInt(cmd.currentValue);
						if(maxJeedom) {
							returnValue = Math.round((returnValue / maxJeedom)*100);
						}
						if (DEV_DEBUG) that.log('debug','---------update Bright(refresh):',returnValue,'% soit',cmd.currentValue,' / ',maxJeedom);
						//that.log('debug','------------Brightness jeedom :',cmd.currentValue,'soit en homekit :',returnValue);
						break;
					}
				}
			break;			
			// Alarm
			case Characteristic.SecuritySystemTargetState.UUID :
				for (const cmd of cmdList) {
					let currentValue = cmd.currentValue;
					
					if (cmd.generic_type == 'ALARM_ENABLE_STATE' && currentValue == 0) {
						if (DEV_DEBUG) that.log('debug',"Alarm_enable_state=",currentValue);
						returnValue = Characteristic.SecuritySystemTargetState.DISARM;
						break;
					}
					if (cmd.generic_type == 'ALARM_MODE') {
						if (DEV_DEBUG) that.log('debug',"alarm_mode=",currentValue);
						
						mode_PRESENT = 	service.alarm.present && service.alarm.present.mode_label || undefined;
						mode_AWAY = 	service.alarm.away && service.alarm.away.mode_label || undefined;
						mode_NIGHT = 	service.alarm.night && service.alarm.night.mode_label || undefined;
						
						switch (currentValue) {
							case undefined:
								if (DEV_DEBUG) that.log('debug',"renvoie absent",Characteristic.SecuritySystemTargetState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
							break;
							default: // back compatibility
								if (DEV_DEBUG) that.log('debug',"renvoie absent",Characteristic.SecuritySystemTargetState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
							break;							
							case mode_PRESENT:
								if (DEV_DEBUG) that.log('debug',"renvoie present",Characteristic.SecuritySystemTargetState.STAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.STAY_ARM;
							break;
							case mode_AWAY:
								if (DEV_DEBUG) that.log('debug',"renvoie absent",Characteristic.SecuritySystemTargetState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
							break;
							case mode_NIGHT:
								if (DEV_DEBUG) that.log('debug',"renvoie nuit",Characteristic.SecuritySystemTargetState.NIGHT_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.NIGHT_ARM;
							break;
						}
					}
				}
			break;
			case Characteristic.SecuritySystemCurrentState.UUID :
				for (const cmd of cmdList) {
					let currentValue = cmd.currentValue;
					
					if (cmd.generic_type == 'ALARM_STATE' && currentValue == 1) {
						if (DEV_DEBUG) that.log('debug',"Alarm_State=",currentValue);
						returnValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
						break;
					}
					if (cmd.generic_type == 'ALARM_ENABLE_STATE' && currentValue == 0) {
						if (DEV_DEBUG) that.log('debug',"Alarm_enable_state=",currentValue);
						returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
						break;
					}
					if (cmd.generic_type == 'ALARM_MODE') {
						if (DEV_DEBUG) that.log('debug',"alarm_mode=",currentValue);
						
						mode_PRESENT = 	service.alarm.present && service.alarm.present.mode_label || undefined;
						mode_AWAY = 	service.alarm.away && service.alarm.away.mode_label || undefined;
						mode_NIGHT = 	service.alarm.night && service.alarm.night.mode_label || undefined;
						
						switch (currentValue) {
							case undefined:
								if (DEV_DEBUG) that.log('debug',"renvoie absent",Characteristic.SecuritySystemCurrentState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
							break;
							default: // back compatibility
								if (DEV_DEBUG) that.log('debug',"renvoie absent",Characteristic.SecuritySystemCurrentState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
							break;							
							case mode_PRESENT:
								if (DEV_DEBUG) that.log('debug',"renvoie present",Characteristic.SecuritySystemCurrentState.STAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.STAY_ARM;
							break;
							case mode_AWAY:
								if (DEV_DEBUG) that.log('debug',"renvoie absent",Characteristic.SecuritySystemCurrentState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
							break;
							case mode_NIGHT:
								if (DEV_DEBUG) that.log('debug',"renvoie nuit",Characteristic.SecuritySystemCurrentState.NIGHT_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
							break;
						}
					}
				}
			break;
			// Thermostats
			case Characteristic.CurrentHeatingCoolingState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_MODE') {
						
						mode_CLIM = service.thermo.clim && service.thermo.clim.mode_label || undefined;
						mode_CHAUF = service.thermo.chauf && service.thermo.chauf.mode_label || undefined;
						
						that.log('debug','CurrentThermo :',mode_CLIM,mode_CHAUF,':',cmd.currentValue);
						switch(cmd.currentValue) {
							case 'Off':
							case 'Aucun':
							case undefined:
								returnValue = Characteristic.CurrentHeatingCoolingState.OFF;
							break;
							case mode_CLIM:
								returnValue = Characteristic.CurrentHeatingCoolingState.COOL;
							break;
							case mode_CHAUF:
								returnValue = Characteristic.CurrentHeatingCoolingState.HEAT;
							break;
						}
						break;
					}
				}
			break;
			case Characteristic.TargetHeatingCoolingState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_MODE') {
						
						mode_CLIM = service.thermo.clim && service.thermo.clim.mode_label || undefined;
						mode_CHAUF = service.thermo.chauf && service.thermo.chauf.mode_label || undefined;
						
						that.log('debug','TargetThermo :',mode_CLIM,mode_CHAUF,':',cmd.currentValue);
						switch(cmd.currentValue) {
							case 'Off':
							case 'Aucun':
							case undefined:
								returnValue = Characteristic.TargetHeatingCoolingState.OFF;
							break;							
							case mode_CLIM:
								returnValue = Characteristic.TargetHeatingCoolingState.COOL;
							break;
							case mode_CHAUF:
								returnValue = Characteristic.TargetHeatingCoolingState.HEAT;
							break;
						}
						break;
					}
				}
			break;
			case Characteristic.TargetTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_SETPOINT') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			// GarageDoor
			case Characteristic.TargetDoorState.UUID :
				HRreturnValue="OPENDef";
				returnValue=Characteristic.TargetDoorState.CLOSED; // if don't know -> CLOSED
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
					    cmd.generic_type == 'BARRIER_STATE') {
						switch(parseInt(cmd.currentValue)) {
								case customValues.OPEN :
									returnValue=Characteristic.TargetDoorState.OPEN; //0
									HRreturnValue="OPEN";	
								break;
								case customValues.CLOSED :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case customValues.OPENING :
									returnValue=Characteristic.TargetDoorState.OPEN; // 0
									HRreturnValue="OPEN";
								break;
								case customValues.CLOSING :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case customValues.STOPPED :
									returnValue=Characteristic.TargetDoorState.OPEN; // 0
									HRreturnValue="OPEN";
								break;
						}
						if (DEV_DEBUG) that.log('debug','Target Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue+" ("+HRreturnValue+")");
						break;
					}
				}	
			break;
			case Characteristic.CurrentDoorState.UUID :
				HRreturnValue="OPENDef";
				returnValue=Characteristic.CurrentDoorState.CLOSED; // if don't know -> CLOSED
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
					    cmd.generic_type == 'BARRIER_STATE') {
						switch(parseInt(cmd.currentValue)) {
								case customValues.OPEN :
									returnValue=Characteristic.CurrentDoorState.OPEN; //0
									HRreturnValue="OPEN";
								break;
								case customValues.CLOSED :
									returnValue=Characteristic.CurrentDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case customValues.OPENING :
									returnValue=Characteristic.CurrentDoorState.OPENING; // 2
									HRreturnValue="OPENING";
								break;
								case customValues.CLOSING :
									returnValue=Characteristic.CurrentDoorState.CLOSING; // 3
									HRreturnValue="CLOSING";
								break;
								case customValues.STOPPED :
									returnValue=Characteristic.CurrentDoorState.STOPPED; // 4
									HRreturnValue="STOPPED";
								break;
						}
						if (DEV_DEBUG) that.log('debug','Etat Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue+" ("+HRreturnValue+")");
						break;
					}
				}
			break;
			// Flaps
			case Characteristic.CurrentPosition.UUID :
			case Characteristic.TargetPosition.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLAP_STATE' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						returnValue = returnValue > 95 ? 100 : returnValue; // >95% is 100% in home (flaps need yearly tunning)
						break;
					}
				}
			break;
			case Characteristic.PositionState.UUID :
				returnValue = Characteristic.PositionState.STOPPED;
			break;
			// Locks
			case Characteristic.LockCurrentState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LOCK_STATE') {
						if (DEV_DEBUG) that.log('debug','LockCurrentState : ',cmd.currentValue);
						returnValue = toBool(cmd.currentValue) == true ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
					}
				}
			break;
			case Characteristic.LockTargetState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LOCK_STATE') {
						if (DEV_DEBUG) that.log('debug','LockTargetState : ',cmd.currentValue);
						returnValue = toBool(cmd.currentValue) == true ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
					}
				}
			break;
			// Speakers
			case Characteristic.Mute.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SPEAKER_MUTE' && cmd.id == service.cmd_id) {
						returnValue = toBool(cmd.currentValue);
						break;
					}
				}
			break;
			case Characteristic.Volume.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SPEAKER_VOLUME' && cmd.id == service.infos.volume.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			// Battery
			case Characteristic.BatteryLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == service.cmd_id) {
						if(cmd.currentValue==="") returnValue=100; // Jeedom Cache not yet up to date
						else returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.ChargingState.UUID :
				var hasFound = false;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY_CHARGING' && cmd.id == service.infos.batteryCharging.id) {
						returnValue = cmd.currentValue;
						if(returnValue == 0) returnValue = Characteristic.ChargingState.NOT_CHARGING;
						else returnValue = Characteristic.ChargingState.CHARGING;
						hasFound = true;
						break;
					}
				}
				if(!hasFound) returnValue = Characteristic.ChargingState.NOT_CHARGEABLE;
			break;
			// Status
			case Characteristic.StatusLowBattery.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						if(cmd.currentValue==="" || returnValue > 20) returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
						else returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
						break;
					}
				}
			break;
			case Characteristic.StatusTampered.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SABOTAGE' && findMyID(service.statusArr,cmd.id) != -1) {
						let eqLogicSabotageInverted=service.sabotageInverted || 0;
						returnValue = eqLogicSabotageInverted==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ?
						//returnValue = cmd.currentValue;
						if(cmd.currentValue!=="" && returnValue === false) returnValue=Characteristic.StatusTampered.TAMPERED;
						else returnValue=Characteristic.StatusTampered.NOT_TAMPERED;
						break;
					}
				}
			break;		
			case Characteristic.StatusFault.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'DEFECT' && findMyID(service.statusArr,cmd.id) != -1) {
						returnValue = toBool(cmd.currentValue);
						if(!returnValue) returnValue = Characteristic.StatusFault.NO_FAULT;
						else returnValue = Characteristic.StatusFault.GENERAL_FAULT;
						break;
					}
				}
			break;
			case Characteristic.StatusActive.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'ACTIVE' && findMyID(service.statusArr,cmd.id) != -1) {
						returnValue = toBool(cmd.currentValue);					
						break;
					}
				}
			break;
			// Consumption
			case Characteristic.CurrentPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'POWER' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.TotalPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CONSUMPTION' && cmd.id == service.infos.consumption.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			// Used ?
			case Characteristic.TimeInterval.UUID :
				returnValue = Date.now();
				returnValue = parseInt(cmdList.timestamp) - returnValue;
				if (returnValue < 0) returnValue = 0;
			break;
			case Characteristic.ProgrammableSwitchEvent.UUID :
				returnValue = cmdList.currentValue;
				if (DEV_DEBUG) that.log('debug','GetState ProgrammableSwitchEvent: '+returnValue);
			break;
			case Characteristic.OutletInUse.UUID :
				returnValue = parseFloat(cmdList.power) > 1.0 ? true : false;
			break;
		}
		return returnValue;
	}
	catch(e){
		this.log('error','Erreur de la fonction getAccessoryValue :',e);
		console.error(e.stack);
	}
};

// -- sanitizeValue
// -- Desc : limit the value to the min and max characteristic + round the float to the same precision than the minStep
// -- Params --
// -- currentValue : value to prepare
// -- characteristic : characteristic containing the props
// -- Return : prepared value
function sanitizeValue(currentValue,characteristic) {
	let val=0;
	if(!characteristic) // just return the value if no characteristic
		return val;
	else
		if(!characteristic.props) 
			return val;
		else 
			if(!characteristic.props.format) 
				return val;

	switch(characteristic.props.format) {
			case "uint8" :
			case "uint16":
			case "uint32" :
			case "uint64" :
				val = parseInt(currentValue);
				val = Math.abs(val); // unsigned
				if(!val) val = 0;
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseInt(characteristic.props.minValue)) val = parseInt(characteristic.props.minValue);
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseInt(characteristic.props.maxValue)) val = parseInt(characteristic.props.maxValue);		
			break;
			case "int" :
				val = parseInt(currentValue);
				if(!val) val = 0;
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseInt(characteristic.props.minValue)) val = parseInt(characteristic.props.minValue);
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseInt(characteristic.props.maxValue)) val = parseInt(characteristic.props.maxValue);	
			break;
			case "float" :
				val = minStepRound(parseFloat(currentValue),characteristic);
				if(!val) val = 0.0;
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseFloat(characteristic.props.minValue)) val = parseFloat(characteristic.props.minValue);
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseFloat(characteristic.props.maxValue)) val = parseFloat(characteristic.props.maxValue);	
			break;
			case "bool" :
				val = toBool(currentValue);
				if(!val) val = false;
			break;
			case "string" :
			case "tlv8" :
				val = currentValue.toString();
				if(!val) val = '';
			break;
	}
	return val;
}

// -- minStepRound
// -- Desc : round the value to the same precision than the minStep
// -- Params --
// -- val : value to round
// -- characteristic : characteristic containing the props
// -- Return : rounded value
function minStepRound(val,characteristic) {
	if(characteristic.props.minStep == null || characteristic.props.minStep == undefined) {
		characteristic.props.minStep = 1;
	}
	let prec = (characteristic.props.minStep.toString().split('.')[1] || []).length;
	if(val) {
		val = val * Math.pow(10, prec);
		val = Math.round(val); // round to the minStep precision
		val = val / Math.pow(10, prec);
	}
	return val;
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

// -- command
// -- Desc : Command from Homebridge to execute in Jeedom
// -- Params --
// -- action : command type
// -- value : value to set (if any)
// -- service : from which Homebridge service
// -- Return : nothing
JeedomPlatform.prototype.command = function(action, value, service) {
	try{
		var that = this;

		var cmdList = that.jeedomClient.getDeviceCmd(service.eqID); 
		
		var cmdId = service.cmd_id;
		let found=false;
		// ALARM
		var id_PRESENT,id_AWAY,id_NIGHT;
		if(action == 'SetAlarmMode') {
			id_PRESENT = 	service.alarm.present && service.alarm.present.mode_id || undefined;
			id_AWAY = 	service.alarm.away && service.alarm.away.mode_id || undefined;
			id_NIGHT = 	service.alarm.night && service.alarm.night.mode_id || undefined;
		}
		// /ALARM	
		// THERMOSTAT
		var id_CHAUF,id_CLIM,id_OFF;
		if(action == 'TargetHeatingCoolingState') {
			id_CHAUF = 	service.thermo.chauf && service.thermo.chauf.mode_id || undefined;
			id_CLIM = 	service.thermo.clim && service.thermo.clim.mode_id || undefined;
			id_OFF = 	service.thermo.off && service.thermo.off.mode_id || undefined;
		}		
		// /THERMOSTAT
		var needToTemporize=0;
		var cmdFound;
		for (const cmd of cmdList) {
			if(!found) {
				switch (cmd.generic_type) {
					case 'FLAP_DOWN' :
						if(action == 'flapDown' && service.actions.down && cmd.id == service.actions.down.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FLAP_UP' :
						if(action == 'flapUp' && service.actions.up && cmd.id == service.actions.up.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FLAP_SLIDER' :
						if(value >= 0 && service.actions.slider && cmd.id == service.actions.slider.id) {// should add action == 'setValue'
							cmdId = cmd.id;
							if (action == 'turnOn' && service.actions.down) {
								cmdId=service.actions.down.id;
							} else if (action == 'turnOff' && service.actions.up) {
								cmdId=service.actions.up.id;
							}		
							// brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to Zwave
							value =	Math.round(value * 99/100);							
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=500;
						}
					break;					
					case 'GB_OPEN' :
						if(action == 'GBopen') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'GB_CLOSE' :
						if(action == 'GBclose') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'GB_TOGGLE' :
						if(action == 'GBtoggle') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'LOCK_OPEN' :
						if(action == 'unsecure') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'LOCK_CLOSE' :
						if(action == 'secure') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'LIGHT_SLIDER' :
						if(action == 'setValue' && service.actions.slider && cmd.id == service.actions.slider.id) {
							cmdId = cmd.id;
							if (action == 'turnOn' && service.actions.on) {
								this.log('info','???????? should never go here ON');
								cmdId=service.actions.on.id;
							} else if (action == 'turnOff' && service.actions.off) {
								this.log('info','???????? should never go here OFF');
								cmdId=service.actions.off.id;
							}		
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=800;
						}
					break;
					case 'SPEAKER_SET_VOLUME' :
						if(action == 'setValue' && service.actions.set_volume && cmd.id == service.actions.set_volume.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=800;
						}
					break;
					case 'SPEAKER_MUTE_TOGGLE' :
						if((action == 'turnOn' || action == 'turnOff') && service.actions.mute_toggle && cmd.id == service.actions.mute_toggle.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'SPEAKER_MUTE_ON' :
						if(action == 'turnOn' && service.actions.mute_on && cmd.id == service.actions.mute_on.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'SPEAKER_MUTE_OFF' :
						if(action == 'turnOff' && service.actions.mute_off && cmd.id == service.actions.mute_off.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'LIGHT_ON' :
						if((action == 'turnOn') && service.actions.on && cmd.id == service.actions.on.id) {
							cmdId = cmd.id;					
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'ENERGY_ON' :
						if((value == 255 || action == 'turnOn') && service.actions.on && cmd.id == service.actions.on.id) {
							cmdId = cmd.id;			
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'LIGHT_OFF' :
						if((action == 'turnOff') && service.actions.off && cmd.id == service.actions.off.id) {
							cmdId = cmd.id;					
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'ENERGY_OFF' :
						if((value == 0 || action == 'turnOff') && service.actions.off && cmd.id == service.actions.off.id) {
							cmdId = cmd.id;		
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'THERMOSTAT_SET_LOCK' :
						if((action == 'turnOn') && service.actions.set_lock && cmd.id == service.actions.set_lock.id) {
							cmdId = cmd.id;				
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'THERMOSTAT_SET_UNLOCK' :
						if((action == 'turnOff') && service.actions.set_unlock && cmd.id == service.actions.set_unlock.id) {
							cmdId = cmd.id;					
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'LIGHT_SET_COLOR' :
						if(action == 'setRGB' && service.actions.setcolor && cmd.id == service.actions.setcolor.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
							//needToTemporize=500;
						}
					break;
					case 'LIGHT_SET_COLOR_TEMP' :
						if(action == 'setValueTemp' && service.actions.setcolor_temp && cmd.id == service.actions.setcolor_temp.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
							needToTemporize=800;
						}
					break;
					case 'ALARM_RELEASED' :
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.DISARM) {
							that.log('debug',"setAlarmMode",value,cmd.id);
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'ALARM_SET_MODE' :
						that.log('debug',"ALARM_SET_MODE","SetAlarmMode=",action,value);
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.NIGHT_ARM && id_NIGHT) {
							cmdId = id_NIGHT;
							that.log('debug',"set nuit");
							found = true;
						}
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.AWAY_ARM && id_AWAY) {
							cmdId = id_AWAY;
							that.log('debug',"set absent");
							found = true;
						}
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.STAY_ARM && id_PRESENT) {
							cmdId = id_PRESENT;
							that.log('debug',"set present");
							found = true;
 						}
 					break;					
					case 'THERMOSTAT_SET_SETPOINT' :
						if(action == 'setTargetLevel') {
							if(value > 0) {
								cmdId = cmd.id;
								cmdFound=cmd.generic_type;
								found = true;
							}
						}
					break;
					case 'THERMOSTAT_SET_MODE' :
						if(action == 'TargetHeatingCoolingState') {
							if(value == Characteristic.TargetHeatingCoolingState.OFF && id_OFF) {
								cmdId = id_OFF;
								that.log('debug',"set OFF");
								found = true;
							}
							if(value == Characteristic.TargetHeatingCoolingState.HEAT && id_CHAUF) {
								cmdId = id_CHAUF;
								that.log('debug',"set CHAUF");
								found = true;
							}
							if(value == Characteristic.TargetHeatingCoolingState.COOL && id_CLIM) {
								cmdId = id_CLIM;
								that.log('debug',"set CLIM");
								found = true;
							}
							/*
							if(cmd.name == 'Off') {
								cmdId = cmd.id;
								found = true;
							}*/
						}
					break;
				}
			}
		}
		
		if(needToTemporize===0) {
			that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
				that.log('info','[Commande envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'value: '+value,'generic:'+cmdFound,'response:'+JSON.stringify(response));
				if(cmdFound=="LIGHT_SLIDER") that.settingLight=false;
			}).catch(function(err, response) {
				that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + service.cmd_id , err , response);
				console.error(err.stack);
			});
		} else {
			clearTimeout(that.temporizator);
			that.temporizator = setTimeout(function(){
				that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
					that.log('info','[Commande envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'value: '+value,'response:'+JSON.stringify(response));
					if(cmdFound=="LIGHT_SLIDER") that.settingLight=false;
				}).catch(function(err, response) {
					that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + service.cmd_id , err , response);
					console.error(err.stack);
				});
			},needToTemporize);
		}
	}
	catch(e){
		this.log('error','Erreur de la fonction command :',e);	
		console.error(e.stack);
	}
};

// -- subscribeUpdate
// -- Desc : Populate the subscriptions to the characteristic. if the value is changed, the characteristic will be updated
// -- Params --
// -- service : service containing the characteristic to subscribe to
// -- characteristic : characteristic to subscribe to
// -- Return : nothing
JeedomPlatform.prototype.subscribeUpdate = function(service, characteristic) {
	try{
		if (characteristic.UUID == Characteristic.PositionState.UUID)
			return;

		this.updateSubscriptions.push({
			'service' : service,
			'characteristic' : characteristic
			});
	}
	catch(e){
		this.log('error','Erreur de la fonction subscribeUpdate :',e);
		console.error(e.stack);
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
		if (updates.result) {
			updates.result.map(function(update) {
				if (update.name == 'cmd::update' && 
				    update.option.value != undefined && 
				    update.option.cmd_id) {
						that.jeedomClient.updateModelInfo(update.option.cmd_id,update.option.value); // Update cachedModel
						that.updateSubscribers(update);// Update subscribers
				}
				else {
					if(DEV_DEBUG) that.log('debug','[Reçu Type non géré]',update.name+' contenu: '+JSON.stringify(update).replace("\n",""));
				}
			});
		}
	}).then(function(){
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','==RESTART POLLING==');that.startPollingUpdate(); }, that.pollerPeriod * 1000);
	}).catch(function(err, response) {
		that.log('error','Erreur de récupération des évènements de mise à jour: ', err, response);
		console.error(err.stack);
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','!!RESTART POLLING AFTER ERROR!!');that.startPollingUpdate(); }, that.pollerPeriod * 2 * 1000);
	});
};

// -- updateSubscribers
// -- Desc : update subcribers populated by the subscribeUpdate method
// -- Params --
// -- update : the update received from Jeedom
// -- Return : nothing
JeedomPlatform.prototype.updateSubscribers = function(update) {
	var that = this;
	var subCharact,subService;
	for (let i = 0; i < that.updateSubscriptions.length; i++) {
		subCharact = that.updateSubscriptions[i].characteristic;
		subService = that.updateSubscriptions[i].service;

		// that.log('debug',"update :",update.option.cmd_id,JSON.stringify(subService.infos),JSON.stringify(subService.statusArr),subCharact.UUID);
		let infoFound = findMyID(subService.infos,update.option.cmd_id);
		let statusFound = findMyID(subService.statusArr,update.option.cmd_id);
		if(	infoFound != -1 || statusFound != -1) {
			let returnValue = sanitizeValue(that.getAccessoryValue(subCharact, subService),subCharact);
			if(infoFound != -1 && infoFound.generic_type=="LIGHT_STATE") { // if it's a LIGHT_STATE
				if(!that.settingLight) { // and it's not currently being modified
					that.log('info','[Commande envoyée à HomeKit]','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+update.option.cmd_id+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+update.option.cmd_id+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);
					subCharact.setValue(returnValue, undefined, 'fromJeedom');
				}
			}
			else {
				that.log('info','[Commande envoyée à HomeKit]','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+update.option.cmd_id+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+update.option.cmd_id+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);
				subCharact.setValue(returnValue, undefined, 'fromJeedom');
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
	console.log(h,s,v,rgb);
	return rgb;
};

// -- updateHomeKitColorFromJeedom
// -- Desc : convert html value (Jeedom) to HSV value (Homebridge)
// -- Params --
// -- color : html color #121212
// -- service : service containing the color
// -- Return : hsv object
JeedomPlatform.prototype.updateHomeKitColorFromJeedom = function(color, service) {
	if (!color)
		color = '0,0,0';
	//this.log('debug',"couleur :" + color);
	//var colors = color.split(',');
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
// -- Return : nothing
JeedomPlatform.prototype.syncColorCharacteristics = function(rgb, service) {
	/*switch (--service.countColorCharacteristics) {
	case -1:
		service.countColorCharacteristics = 2;*/
		var that = this;

		clearTimeout(service.timeoutIdColorCharacteristics);
		service.timeoutIdColorCharacteristics = setTimeout(function() {
			//if (service.countColorCharacteristics < 2)
			//	return;
			var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
			if (DEV_DEBUG) that.log('debug',"---------setRGB : ",rgbColor);
			that.command('setRGB', rgbColor, service);
			//service.countColorCharacteristics = 0;
			//service.timeoutIdColorCharacteristics = 0;
		}, 500);
		/*break;
	case 0:
		var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
		this.command('setRGB', rgbColor, service);
		service.countColorCharacteristics = 0;
		service.timeoutIdColorCharacteristics = 0;
		break;
	default:
		break;
	}*/
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

	Characteristic.UVIndex = function() {
		Characteristic.call(this, 'UV Index', '05ba0fe0-b848-4226-906d-5b64272e05ce');
		this.setProps({
			format: Characteristic.Formats.UINT8,
			maxValue: 10,
			minValue: 0,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.UVIndex, Characteristic);	
	Characteristic.UVIndex.UUID = '05ba0fe0-b848-4226-906d-5b64272e05ce';

	Characteristic.AirPressure = function() {
		Characteristic.call(this, 'Air Pressure', 'E863F10F-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT16,
			unit: "hPa",
			maxValue: 1100,
			minValue: 700,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.AirPressure, Characteristic);	
	Characteristic.AirPressure.UUID = 'E863F10F-079E-48FF-8F27-9C2605A29F52';

	Characteristic.GenericINT = function() {
		Characteristic.call(this, 'ValueINT', '2ACF6D35-4FBF-4688-8787-6D5C4BA3A263');
		this.setProps({
		  format:   Characteristic.Formats.INT,
		  minStep: 1,
		  perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY ]
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericINT.UUID = '2ACF6D35-4FBF-4688-8787-6D5C4BA3A263';
	inherits(Characteristic.GenericINT, Characteristic);	
	
	Characteristic.GenericFLOAT = function() {
		Characteristic.call(this, 'ValueFLOAT', '0168A695-70A7-4AF7-A800-417D30055719');
		this.setProps({
		  format:   Characteristic.Formats.FLOAT,
		  minStep: 0.01,
		  perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY ]
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericFLOAT.UUID = '0168A695-70A7-4AF7-A800-417D30055719';
	inherits(Characteristic.GenericFLOAT, Characteristic);		
	
	Characteristic.GenericBOOL = function() {
		Characteristic.call(this, 'ValueBOOL', 'D8E3301A-CD20-4AAB-8F70-F80789E6ADCB');
		this.setProps({
		  format:   Characteristic.Formats.BOOL,
		  perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY ]
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericBOOL.UUID = 'D8E3301A-CD20-4AAB-8F70-F80789E6ADCB';
	inherits(Characteristic.GenericBOOL, Characteristic);	

	Characteristic.GenericSTRING = function() {
		Characteristic.call(this, 'ValueSTRING', 'EB19CE11-01F4-47DD-B7DA-B81C0640A5C1');
		this.setProps({
		  format:   Characteristic.Formats.STRING,
		  perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY ]
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericSTRING.UUID = 'EB19CE11-01F4-47DD-B7DA-B81C0640A5C1';
	inherits(Characteristic.GenericSTRING, Characteristic);		

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

	/**
	 * Custom Service 'Custom Service'
	 */
	 
	Service.CustomService = function (displayName, subtype) {
		Service.call(this, displayName, 'BF0477D3-699A-42F1-BF98-04FCCFE5C8E7', subtype);

		this.addOptionalCharacteristic(Characteristic.Name);
	};
	inherits(Service.CustomService, Service);	
	Service.CustomService.UUID = 'BF0477D3-699A-42F1-BF98-04FCCFE5C8E7';
	
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
	var service;
	try {
		var cachedValue, characteristic;
		for (var s = 0; s < services.length; s++) {
			service = services[s];
			
			if(!newAccessory.getService(service.controlService)){// not exist ?
				this.log('info',' Ajout service :'+service.controlService.displayName+' subtype:'+service.controlService.subtype+' cmd_id:'+service.controlService.cmd_id+' UUID:'+service.controlService.UUID);
				newAccessory.addService(service.controlService);
				for (var i = 0; i < service.characteristics.length; i++) {
					characteristic = service.controlService.getCharacteristic(service.characteristics[i]);
					
					cachedValue = cachedValues[service.controlService.subtype+characteristic.displayName];
					if(cachedValue != undefined && cachedValue != null){
						characteristic.setValue(sanitizeValue(cachedValue,characteristic), undefined, 'fromCache');
					}
					
					characteristic.props.needsBinding = true;
					if (characteristic.UUID == Characteristic.CurrentAmbientLightLevel.UUID) {
						characteristic.props.minValue = 0;
					}
					if (characteristic.UUID == Characteristic.CurrentTemperature.UUID) {
						characteristic.props.minValue = -50;
						characteristic.props.minStep = 0.01;
					}
					this.platform.bindCharacteristicEvents(characteristic, service.controlService);
					this.log('info','    Caractéristique :'+characteristic.displayName+' valeur initiale:'+characteristic.value);
				}
			}
			else
				this.log('debug','On essaye d\'ajouter un service mais il existe déjà : ',service.controlService);
		}
	}
	catch(e){
		this.log('error','Erreur de la fonction addServices :',e,JSON.stringify(service.controlService));
		console.error(e.stack);
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [newAccessory]);
		hasError=true;
	}
};

// -- delServices
// -- Desc : deleting the services from the accessory
// -- Params --
// -- accessory : accessory to delete the services from
// -- Return : nothing
JeedomBridgedAccessory.prototype.delServices = function(accessory) {
	var service;
	try {
			var serviceList=[];
			var cachedValues=[];
			for(var t=0; t< accessory.services.length;t++) { 
				if(accessory.services[t].UUID != Service.AccessoryInformation.UUID && 
				   accessory.services[t].UUID != Service.BridgingState.UUID)
					serviceList.push(accessory.services[t]);
			}		
			for(service of serviceList){ // dont work in one loop or with temp object :(
				this.log('info',' Suppression service :'+service.displayName+' subtype:'+service.subtype+' UUID:'+service.UUID);
				for (const c of service.characteristics) {
					this.log('info','    Caractéristique :'+c.displayName+' valeur cache:'+c.value);
					cachedValues[service.subtype+c.displayName]=c.value;
				}
				accessory.removeService(service);
			}
			return cachedValues;
	}
	catch(e){
		this.log('error','Erreur de la fonction delServices :',e,JSON.stringify(service));
		console.error(e.stack);
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [accessory]);
		hasError=true;
	}
};

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
		s = h.s;
		v = h.v;
		h = h.h;
	}
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
	case 0:
		r = v;
		g = t;
		b = p;
		break;
	case 1:
		r = q;
		g = v;
		b = p;
		break;
	case 2:
		r = p;
		g = v;
		b = t;
		break;
	case 3:
		r = p;
		g = q;
		b = v;
		break;
	case 4:
		r = t;
		g = p;
		b = v;
		break;
	case 5:
		r = v;
		g = p;
		b = q;
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
		r = r.r;
		g = r.g;
		b = r.b;
	}
	var max = Math.max(r, g, b);
	var min = Math.min(r, g, b);
	var d = max - min;
	var h;
	var s = (max === 0 ? 0 : d / max);
	var v = max / 255;

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

// -- findMyID
// -- Desc : search an id in an object
// -- Params --
// -- id : id to find
// -- Return : Object found
function findMyID(obj,id) {
	for(var o in obj) {
        //if( obj.hasOwnProperty( o ) && obj[o] && obj[o].id && parseInt(obj[o].id) && parseInt(id) && parseInt(obj[o].id)==parseInt(id)) {
        if( obj.hasOwnProperty( o ) && obj[o] && obj[o].id && obj[o].id==id) {
			return obj[o];
        }
    }
	return -1;
}
