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

// -- truncate32
// -- Desc : Matter's Basic Information string fields (vendorName, productName, serialNumber, nodeLabel) are capped at 32 chars by spec; longer values make the whole accessory fail to initialize
function truncate32(str) {
	return (typeof str === 'string' && str.length > 32) ? str.slice(0, 32) : str;
}

// -- buildManufacturer
// -- Desc : Build the Matter vendorName; always keep the room, drop the pseudo suffix before resorting to a hard truncate
function buildManufacturer(room, origName, pseudo, displayName) {
	const full = room + '>' + origName + (pseudo ? ' (' + displayName + ')' : '');
	if (full.length <= 32) {return full;}
	return truncate32(room + '>' + origName);
}

// -- buildSerialNumber
// -- Desc : Build the Matter serialNumber; drop the cosmetic <> wrapper first, then the logicalId, before resorting to a hard truncate
function buildSerialNumber(id, logicalId, configName) {
	const logicalPart = (logicalId && typeof logicalId === 'string') ? '-'+logicalId.replace(/\//g,'\\') : '';
	const withBrackets = '<'+id+logicalPart+'-'+configName+'>';
	if (withBrackets.length <= 32) {return withBrackets;}
	const noBrackets = id+logicalPart+'-'+configName;
	if (noBrackets.length <= 32) {return noBrackets;}
	const noLogicalId = id+'-'+configName;
	if (noLogicalId.length <= 32) {return noLogicalId;}
	return truncate32(noLogicalId);
}

// -- buildSensorAccessory
// -- Desc : Shared skeleton for read-only Matter sensor accessories (Motion/Occupancy/Contact); same descriptor shape as buildOnOffAccessory minus handlers
function buildSensorAccessory(Plateform, eqLogic, Serv, displayName, deviceType, clusters) {
	const uuid = Plateform.api.hap.uuid.generate('matter-' + Serv.subtype);
	Serv.matterUUID = uuid;
	Serv.matterDisplayName = displayName;
	return {
		UUID: uuid,
		displayName: truncate32(displayName),
		manufacturer: buildManufacturer(Plateform.rooms[eqLogic.object_id], eqLogic.origName, eqLogic.pseudo, displayName),
		model: ((eqLogic.eqType_name == "jeelink" && eqLogic.real_eqType) ? eqLogic.eqType_name+':'+eqLogic.real_eqType : eqLogic.eqType_name),
		serialNumber: buildSerialNumber(eqLogic.id, eqLogic.logicalId, Plateform.config.name),
		context: {},
		deviceType: deviceType,
		clusters: clusters,
	};
}

// -- JeedomMatter
// -- Desc : Builds/reads/writes Matter accessories on behalf of a JeedomPlatform instance.
// --        One get/set/push trio per Matter cluster type; buildXAccessory() assembles the descriptor.
// -- Params --
// -- Plateform : the JeedomPlatform instance (.command, .getAccessoryValue, .api, .rooms, .config, .log)
function JeedomMatter(Plateform) {
	this.Plateform = Plateform;
}

// -- buildOnOffAccessory
// -- Desc : Build a Matter on/off (outlet) accessory descriptor, reusing the same Serv used by HomeKit
// -- Params --
// -- eqLogic : the jeedom eqLogic
// -- Serv : the HomeKit controlService already built for this device (energy or Switch block)
// -- displayName : name to give to the Matter accessory
// -- Return : the Matter accessory descriptor
JeedomMatter.prototype.buildOnOffAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const uuid = Plateform.api.hap.uuid.generate('matter-' + Serv.subtype);
	Serv.matterUUID = uuid;
	Serv.matterDisplayName = displayName;
	const clusters = {onOff: {onOff: this.getOnOffState(Serv)}};
	const powerValue = this.getPowerState(Serv);
	if (powerValue !== null) {clusters.electricalPowerMeasurement = {activePower: powerValue};}
	const energyValue = this.getEnergyState(Serv);
	if (energyValue !== null) {clusters.electricalEnergyMeasurement = {cumulativeEnergyImported: {energy: energyValue}};}
	return {
		UUID: uuid,
		displayName: truncate32(displayName),
		manufacturer: buildManufacturer(Plateform.rooms[eqLogic.object_id], eqLogic.origName, eqLogic.pseudo, displayName),
		model: ((eqLogic.eqType_name == "jeelink" && eqLogic.real_eqType) ? eqLogic.eqType_name+':'+eqLogic.real_eqType : eqLogic.eqType_name),
		serialNumber: buildSerialNumber(eqLogic.id, eqLogic.logicalId, Plateform.config.name),
		context: {},
		deviceType: Plateform.api.matter.deviceTypes.OnOffOutlet,
		clusters: clusters,
		handlers: {
			onOff: {
				on: () => {this.setOnOffState(Serv, true);},
				off: () => {this.setOnOffState(Serv, false);},
				toggle: () => {this.setOnOffState(Serv, !this.getOnOffState(Serv));},
			},
		},
	};
};

// -- getOnOffState
// -- Desc : Read the current on/off boolean state of a service, as seen by Jeedom
JeedomMatter.prototype.getOnOffState = function(Serv) {
	return toBool(this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.On.UUID}, Serv));
};

// -- getPowerState
// -- Desc : Read the current instantaneous power of a service, in milliwatts (Matter unit), or null if no power sensor
JeedomMatter.prototype.getPowerState = function(Serv) {
	if (!Serv.infos.power) {return null;}
	const watts = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.CurrentPowerConsumption.UUID}, Serv);
	return (typeof watts === 'number') ? Math.round(watts * 1000) : null;
};

// -- getEnergyState
// -- Desc : Read the current cumulative energy of a service, in milliwatt-hours (Matter unit), or null if no consumption sensor
JeedomMatter.prototype.getEnergyState = function(Serv) {
	if (!Serv.infos.consumption) {return null;}
	const kWh = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.TotalPowerConsumption.UUID}, Serv);
	return (typeof kWh === 'number') ? Math.round(Math.max(kWh, 0) * 1000000) : null;
};

// -- setOnOffState
// -- Desc : Send an on/off command to Jeedom on behalf of a Matter controller
JeedomMatter.prototype.setOnOffState = function(Serv, value) {
	this.Plateform.log('info','[Commande de Matter]','Nom:'+Serv.matterDisplayName+'('+Serv.matterUUID+'):'+value);
	this.Plateform.command(value ? 'turnOn' : 'turnOff', null, Serv);
};

// -- pushOnOffState
// -- Desc : Push a state change coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
// -- value : already-sanitized boolean, reused as-is (avoids a 2nd getAccessoryValue call and its fakegato side effect)
// -- logMessage : shared "cause" text also logged for the HomeKit push; destination name is appended per-destination
JeedomMatter.prototype.pushOnOffState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'onOff', {onOff: value}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter onOff :',err);
	});
};

// -- pushPowerState
// -- Desc : Push an instantaneous power change (Watts) coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
JeedomMatter.prototype.pushPowerState = function(Serv, watts, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'electricalPowerMeasurement', {activePower: Math.round(watts * 1000)}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter electricalPowerMeasurement :',err);
	});
};

// -- pushEnergyState
// -- Desc : Push a cumulative energy change (kWh) coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
JeedomMatter.prototype.pushEnergyState = function(Serv, kWh, logMessage) {
	if (!Serv.matterUUID || typeof kWh !== 'number') {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'electricalEnergyMeasurement', {cumulativeEnergyImported: {energy: Math.round(Math.max(kWh, 0) * 1000000)}}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter electricalEnergyMeasurement :',err);
	});
};

// -- buildMotionAccessory / getMotionState / pushMotionState
// -- Desc : Matter has no separate "motion" concept; this maps to the same OccupancySensing cluster as Occupancy below
JeedomMatter.prototype.buildMotionAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {occupancySensing: {occupancy: {occupied: this.getMotionState(Serv)}}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.MotionSensor, clusters);
};
JeedomMatter.prototype.getMotionState = function(Serv) {
	return toBool(this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.MotionDetected.UUID}, Serv));
};
JeedomMatter.prototype.pushMotionState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'occupancySensing', {occupancy: {occupied: value}}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter occupancySensing :',err);
	});
};

// -- buildOccupancyAccessory / getOccupancyState / pushOccupancyState
JeedomMatter.prototype.buildOccupancyAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {occupancySensing: {occupancy: {occupied: this.getOccupancyState(Serv)}}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.MotionSensor, clusters);
};
JeedomMatter.prototype.getOccupancyState = function(Serv) {
	const Plateform = this.Plateform;
	const val = Plateform.getAccessoryValue({UUID: Plateform.api.hap.Characteristic.OccupancyDetected.UUID}, Serv);
	return val === Plateform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
};
JeedomMatter.prototype.pushOccupancyState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	const occupied = (value === this.Plateform.api.hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'occupancySensing', {occupancy: {occupied: occupied}}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter occupancySensing :',err);
	});
};

// -- buildContactAccessory / getContactState / pushContactState
JeedomMatter.prototype.buildContactAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {booleanState: {stateValue: this.getContactState(Serv)}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.ContactSensor, clusters);
};
JeedomMatter.prototype.getContactState = function(Serv) {
	const Plateform = this.Plateform;
	const val = Plateform.getAccessoryValue({UUID: Plateform.api.hap.Characteristic.ContactSensorState.UUID}, Serv);
	// Correction : renvoyer true quand le contact n'est PAS détecté (Ouvert)
	return val === Plateform.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
};
JeedomMatter.prototype.pushContactState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	// Correction : l'état 'opened' est true quand le contact n'est PAS détecté
	const opened = (value === this.Plateform.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'booleanState', {stateValue: opened}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter booleanState :',err);
	});
};

// -- buildTemperatureAccessory / getTemperatureState / pushTemperatureState
// -- Desc : Matter's temperatureMeasurement.measuredValue is int16, hundredths of a degree Celsius
JeedomMatter.prototype.buildTemperatureAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {temperatureMeasurement: {measuredValue: this.getTemperatureState(Serv)}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.TemperatureSensor, clusters);
};
JeedomMatter.prototype.getTemperatureState = function(Serv) {
	const celsius = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.CurrentTemperature.UUID}, Serv);
	return (typeof celsius === 'number') ? Math.round(celsius * 100) : null;
};
JeedomMatter.prototype.pushTemperatureState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'temperatureMeasurement', {measuredValue: Math.round(value * 100)}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter temperatureMeasurement :',err);
	});
};

// -- buildHumidityAccessory / getHumidityState / pushHumidityState
// -- Desc : Matter's relativeHumidityMeasurement.measuredValue is uint16, hundredths of a percent
JeedomMatter.prototype.buildHumidityAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {relativeHumidityMeasurement: {measuredValue: this.getHumidityState(Serv)}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.HumiditySensor, clusters);
};
JeedomMatter.prototype.getHumidityState = function(Serv) {
	const percent = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.CurrentRelativeHumidity.UUID}, Serv);
	return (typeof percent === 'number') ? Math.round(percent * 100) : null;
};
JeedomMatter.prototype.pushHumidityState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'relativeHumidityMeasurement', {measuredValue: Math.round(value * 100)}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter relativeHumidityMeasurement :',err);
	});
};

// -- buildBrightnessAccessory / getBrightnessState / pushBrightnessState
JeedomMatter.prototype.buildBrightnessAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {illuminanceMeasurement: {measuredValue: this.getBrightnessState(Serv)}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.LightSensor, clusters);
};
JeedomMatter.prototype.getBrightnessState = function(Serv) {
	const lux = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.CurrentAmbientLightLevel.UUID}, Serv);
	if (typeof lux !== 'number') { return null; }
	// Matter illuminance is 10000 * log10(lux) + 1. Lux of 0 is invalid (min 1).
	const safeLux = Math.max(lux, 0.0001);
	return Math.max(0, Math.round(10000 * Math.log10(safeLux) + 1));
};
JeedomMatter.prototype.pushBrightnessState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID || typeof value !== 'number') {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	const safeLux = Math.max(value, 0.0001);
	const measuredValue = Math.max(0, Math.round(10000 * Math.log10(safeLux) + 1));
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'illuminanceMeasurement', {measuredValue: measuredValue}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter illuminanceMeasurement :',err);
	});
};

// -- buildSmokeAccessory / getSmokeState / pushSmokeState
JeedomMatter.prototype.buildSmokeAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {smokeCoAlarm: {smokeState: this.getSmokeState(Serv)}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.SmokeSensor, clusters);
};
JeedomMatter.prototype.getSmokeState = function(Serv) {
	const Plateform = this.Plateform;
	const val = Plateform.getAccessoryValue({UUID: Plateform.api.hap.Characteristic.SmokeDetected.UUID}, Serv);
	// 0 = Normal, 2 = Critical (Matter AlarmState enum)
	return (val === Plateform.api.hap.Characteristic.SmokeDetected.SMOKE_DETECTED) ? 2 : 0;
};
JeedomMatter.prototype.pushSmokeState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	const smokeStateValue = (value === this.Plateform.api.hap.Characteristic.SmokeDetected.SMOKE_DETECTED) ? 2 : 0;
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'smokeCoAlarm', {smokeState: smokeStateValue}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter smokeCoAlarm :',err);
	});
};

// -- buildLeakAccessory / getLeakState / pushLeakState
JeedomMatter.prototype.buildLeakAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const clusters = {booleanState: {stateValue: this.getLeakState(Serv)}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.WaterLeakDetector, clusters);
};
JeedomMatter.prototype.getLeakState = function(Serv) {
	const Plateform = this.Plateform;
	const val = Plateform.getAccessoryValue({UUID: Plateform.api.hap.Characteristic.LeakDetected.UUID}, Serv);
	return val === Plateform.api.hap.Characteristic.LeakDetected.LEAK_DETECTED;
};
JeedomMatter.prototype.pushLeakState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	const leaked = (value === this.Plateform.api.hap.Characteristic.LeakDetected.LEAK_DETECTED);
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'booleanState', {stateValue: leaked}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter booleanState (leak) :',err);
	});
};

// -- registerAccessories
// -- Desc : Register newly built Matter accessories with Homebridge, isolating Matter errors from the HAP error path
// -- Params --
// -- matterAccessories : array of Matter accessory descriptors built by buildOnOffAccessory (or future siblings)
JeedomMatter.prototype.registerAccessories = function(matterAccessories) {
	try{
		this.Plateform.api.matter.registerPlatformAccessories('homebridge-jeedom', 'Jeedom', matterAccessories).catch((err) => {
			this.Plateform.log('error','Erreur de l\'enregistrement d\'accessoire(s) Matter :',err);
		});
	}
	catch(e){
		this.Plateform.log('error','Erreur de la fonction registerAccessories :',e);
		console.error(e.stack);
	}
};

module.exports.createHelper = function(Plateform) {
	return new JeedomMatter(Plateform);
};
