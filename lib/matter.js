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

// -- toBatChargeState
// -- Desc : Matter powerSource.batChargeState enum : 0 = Unknown, 1 = IsCharging, 2 = IsAtFullCharge, 3 = IsNotCharging
// --        Only charging / not charging are known from Jeedom; anything else (e.g. HomeKit's "not chargeable") stays undefined so the attribute is left alone (Unknown)
function toBatChargeState(hapChargingState, Characteristic) {
	if (hapChargingState === Characteristic.ChargingState.CHARGING) {return 1;}
	if (hapChargingState === Characteristic.ChargingState.NOT_CHARGING) {return 3;}
	return undefined;
}

// -- BAT_FULL_PERCENT / deriveBatChargeState
// -- Desc : Jeedom has no "full" information, so IsAtFullCharge (2) is deduced : the BATTERY_CHARGING command says "charging" AND the level is above BAT_FULL_PERCENT.
// --        Not charging stays IsNotCharging whatever the level (a battery slowly draining at 90% isn't "full"); undefined (no charging command) stays undefined
const BAT_FULL_PERCENT = 95;
function deriveBatChargeState(chargeState, percent) {
	if (chargeState === 1 && typeof percent === 'number' && percent > BAT_FULL_PERCENT) {return 2;}
	return chargeState;
}

// -- toMatterIlluminance
// -- Desc : Matter illuminanceMeasurement.measuredValue = 10000 * log10(lux) + 1 (the wiki drops the +1, the Matter spec has it), bounded by the minMeasuredValue / maxMeasuredValue declared in the cluster :
// --        1 (= 1 lux) to 65534 (~3.6 million lux, uint16 max 0xFFFF being reserved for null), the widest range the attributes allow
// --        null when the value isn't numeric; below 1 lux (incl. 0 and negatives) it's clamped to 1 instead of producing 0 or a negative number, and above the range to 65534
const MATTER_ILLUMINANCE_MIN = 1;
const MATTER_ILLUMINANCE_MAX = 65534;
function toMatterIlluminance(lux) {
	if (typeof lux !== 'number' || !Number.isFinite(lux)) {return null;}
	const safeLux = Math.max(lux, 0.0001);
	const measured = Math.round(10000 * Math.log10(safeLux) + 1);
	return Math.min(MATTER_ILLUMINANCE_MAX, Math.max(MATTER_ILLUMINANCE_MIN, measured));
}

// -- percentToMatterLevel / matterLevelToPercent
// -- Desc : Matter levelControl.currentLevel of a light is 1..254 (the Lighting feature reserves 0 for "off"), HomeKit / Jeedom brightness is 0..100 %.
// --        A percent of 0 (light off) gives 1 : the level of an off light is kept by the onOff cluster, not by a level of 0.
// --        Back to percent, never 0 (1 % at least) : a level is a brightness of a light that stays on, turning off goes through onOff.
// --        null when the value isn't numeric
const MATTER_LEVEL_MIN = 1;
const MATTER_LEVEL_MAX = 254;
function percentToMatterLevel(percent) {
	const n = Number(percent);
	if (percent === null || percent === '' || !Number.isFinite(n)) {return null;}
	return Math.min(MATTER_LEVEL_MAX, Math.max(MATTER_LEVEL_MIN, Math.round(n * MATTER_LEVEL_MAX / 100)));
}
function matterLevelToPercent(level) {
	const n = Number(level);
	if (level === null || level === '' || !Number.isFinite(n)) {return null;}
	return Math.min(100, Math.max(1, Math.round(n * 100 / MATTER_LEVEL_MAX)));
}

// -- clampMireds
// -- Desc : Matter colorControl.colorTemperatureMireds must stay within colorTempPhysicalMinMireds..colorTempPhysicalMaxMireds (and 1..65279)
// --        colorMode / enhancedColorMode : 0 = hue/saturation, 1 = xy, 2 = color temperature
const MATTER_MIREDS_MAX = 65279;
const MATTER_COLOR_MODE_CT = 2;
function clampMireds(mireds, range) {
	return Math.min(range.max, Math.max(range.min, Math.round(mireds)));
}

// -- toBatPercentRemaining
// -- Desc : Matter powerSource.batPercentRemaining is double the percentage (0-200, 100% = 200); null when the value isn't numeric
function toBatPercentRemaining(percent) {
	const n = parseFloat(percent);
	return Number.isFinite(n) ? Math.round(Math.min(Math.max(n, 0), 100) * 2) : null;
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
// -- Desc : Shared skeleton for Matter accessories built from a HomeKit service : read-only sensors (Motion/Occupancy/Contact...) and lights (with handlers)
// -- handlers : optional Matter command handlers (controller -> Jeedom), omitted for read-only sensors
function buildSensorAccessory(Plateform, eqLogic, Serv, displayName, deviceType, clusters, handlers) {
	const uuid = Plateform.api.hap.uuid.generate('matter-' + Serv.subtype);
	Serv.matterUUID = uuid;
	Serv.matterDisplayName = displayName;
	Plateform.matter.activeUUIDs.add(uuid);
	const accessory = {
		UUID: uuid,
		displayName: truncate32(displayName),
		manufacturer: buildManufacturer(Plateform.rooms[eqLogic.object_id], eqLogic.origName, eqLogic.pseudo, displayName),
		model: ((eqLogic.eqType_name == "jeelink" && eqLogic.real_eqType) ? eqLogic.eqType_name+':'+eqLogic.real_eqType : eqLogic.eqType_name),
		serialNumber: buildSerialNumber(eqLogic.id, eqLogic.logicalId, Plateform.config.name),
		context: {},
		deviceType: deviceType,
		clusters: clusters,
	};
	if (handlers) {accessory.handlers = handlers;}
	// Plateform.matter is the JeedomMatter helper (set in index.js right after createHelper)
	return Plateform.matter.attachPowerSource(eqLogic, accessory);
}

// -- JeedomMatter
// -- Desc : Builds/reads/writes Matter accessories on behalf of a JeedomPlatform instance.
// --        One get/set/push trio per Matter cluster type; buildXAccessory() assembles the descriptor.
// -- Params --
// -- Plateform : the JeedomPlatform instance (.command, .getAccessoryValue, .api, .rooms, .config, .log)
function JeedomMatter(Plateform) {
	this.Plateform = Plateform;
	// eqLogic id -> Map(Matter accessory UUID -> displayName) of the accessories carrying that eqLogic's powerSource cluster
	this.powerSourceTargets = new Map();
	// eqLogic id -> {percent: last known level 0-100 or null, charge: last known raw charge state (1 charging / 3 not charging) or undefined, sent: last batChargeState sent to Matter}
	// "Full" needs both level and charge, which Jeedom updates separately
	this.powerSourceState = new Map();
	// UUIDs of the Matter accessories built during this run : they must survive the unregistration of a HomeKit accessory sharing their services (see unregisterForAccessory)
	this.activeUUIDs = new Set();
	this.cachedUUIDs = new Map(); // Matter accessories restored from the Homebridge cache : UUID => displayName
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
	this.activeUUIDs.add(uuid);
	const clusters = {onOff: {onOff: this.getOnOffState(Serv)}};
	const powerValue = this.getPowerState(Serv);
	if (powerValue !== null) {clusters.electricalPowerMeasurement = {activePower: powerValue};}
	const energyAttributes = this.getEnergyAttributes(Serv);
	if (energyAttributes !== null) {clusters.electricalEnergyMeasurement = energyAttributes;}
	const accessory = {
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
	return this.attachPowerSource(eqLogic, accessory);
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
// -- Desc : Read the current cumulative consumed energy of a service, in milliwatt-hours (Matter unit), or null if no consumption sensor. May be negative (legacy way of giving a production).
JeedomMatter.prototype.getEnergyState = function(Serv) {
	if (!Serv.infos.consumption) {return null;}
	const kWh = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.TotalPowerConsumption.UUID}, Serv);
	return (typeof kWh === 'number' && Number.isFinite(kWh)) ? Math.round(kWh * 1000000) : null;
};

// -- getProductionState
// -- Desc : Read the current cumulative produced energy (generic type PRODUCTION) of a service, in milliwatt-hours, or null if no production sensor / no usable value.
// --        Same units as CONSUMPTION : kWh, or Wh if the command says so.
JeedomMatter.prototype.getProductionState = function(Serv) {
	if (!Serv.infos.production) {return null;}
	const cmdList = this.Plateform.jeedomClient.getDeviceCmdFromCache(Serv.eqID) || [];
	const cmd = cmdList.find((c) => c.generic_type == 'PRODUCTION' && c.id == Serv.infos.production.id);
	if (!cmd) {return null;}
	let kWh = Number(cmd.currentValue);
	if (cmd.currentValue === '' || cmd.currentValue === null || !Number.isFinite(kWh)) {return null;}
	if (Serv.infos.production.unite && Serv.infos.production.unite.toLowerCase() == 'wh') {kWh = kWh / 1000;}
	return Math.round(kWh * 1000000);
};

// -- getEnergyAttributes
// -- Desc : Matter electricalEnergyMeasurement attributes of a service : always imported AND exported (Homebridge picks the cluster features from the declared attributes at registration, so both must exist from the start).
// --        With a PRODUCTION command : exported = production, imported = consumption (negative ignored).
// --        Without : exported = a negative consumption (legacy), imported = a positive one.
// -- Return : {cumulativeEnergyImported, cumulativeEnergyExported} in mWh, or null if there is no consumption nor production sensor
JeedomMatter.prototype.getEnergyAttributes = function(Serv) {
	const consumed = this.getEnergyState(Serv);
	let imported, exported;
	if (Serv.infos.production) {
		const produced = this.getProductionState(Serv);
		if (consumed === null && produced === null) {return null;}
		imported = Math.max(consumed || 0, 0);
		exported = Math.max(produced || 0, 0);
	} else {
		if (consumed === null) {return null;}
		imported = Math.max(consumed, 0);
		exported = Math.max(-consumed, 0);
	}
	return {cumulativeEnergyImported: {energy: imported + 0}, cumulativeEnergyExported: {energy: exported + 0}}; // + 0 : no -0
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
// -- Desc : Push the cumulative energy (imported and exported, read again from Jeedom's cache) to the Matter controller; no-op if Serv isn't a Matter accessory
JeedomMatter.prototype.pushEnergyState = function(Serv, logMessage) {
	if (!Serv.matterUUID) {return;}
	const attributes = this.getEnergyAttributes(Serv);
	if (attributes === null) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'electricalEnergyMeasurement', attributes).catch((err) => {
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
	// Matter booleanState (ContactSensor) : true = fermé (contact détecté), false = ouvert
	return val === Plateform.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
};
JeedomMatter.prototype.pushContactState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	// Correction : l'état 'closed' est true quand le contact est détecté
	const closed = (value === this.Plateform.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED);
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'booleanState', {stateValue: closed}).catch((err) => {
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
	// the range is declared in the cluster (as in the homebridge-matter wiki example) so controllers know it, and measuredValue stays inside it (toMatterIlluminance clamps to the same bounds)
	const clusters = {illuminanceMeasurement: {
		measuredValue: this.getBrightnessState(Serv),
		minMeasuredValue: MATTER_ILLUMINANCE_MIN,
		maxMeasuredValue: MATTER_ILLUMINANCE_MAX,
	}};
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.LightSensor, clusters);
};
JeedomMatter.prototype.getBrightnessState = function(Serv) {
	const lux = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.CurrentAmbientLightLevel.UUID}, Serv);
	return toMatterIlluminance(lux);
};
JeedomMatter.prototype.pushBrightnessState = function(Serv, value, logMessage) {
	const measuredValue = toMatterIlluminance(value);
	if (!Serv.matterUUID || measuredValue === null) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
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
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, Plateform.api.matter.deviceTypes.LeakSensor, clusters);
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

// -- getLightKind
// -- Desc : Which Matter light a HomeKit Lightbulb service becomes, from what Jeedom can do with it (an info alone, without its action, isn't enough) :
// --        'onoff'    : no Action/Lumière Slider (a brightness info without slider stays on/off : Matter can't show a read-only level),
// --        'dimmable' : slider, without color nor color temperature,
// --        'ct'       : slider + color temperature (info and action), without color,
// --        'color'    : slider + color (info and action), with or without color temperature.
// --        Without slider, color and color temperature are not exposed (every Matter color light needs a level).
JeedomMatter.prototype.getLightKind = function(Serv) {
	if (!Serv.actions.slider) {return 'onoff';}
	if (Serv.infos.color && Serv.actions.setcolor) {return 'color';}
	if (Serv.infos.color_temp && Serv.actions.setcolor_temp) {return 'ct';}
	return 'dimmable';
};

// -- buildLightAccessory
// -- Desc : Build a Matter light accessory descriptor (OnOffLight, DimmableLight or ColorTemperatureLight), reusing the HomeKit Lightbulb service
// -- Params --
// -- eqLogic : the jeedom eqLogic
// -- Serv : the HomeKit Lightbulb controlService
// -- displayName : name to give to the Matter accessory
// -- Return : the Matter accessory descriptor, or null when this kind of light isn't exposed in Matter yet (color)
JeedomMatter.prototype.buildLightAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const kind = this.getLightKind(Serv);
	if (kind == 'color') {
		Plateform.log('|info','Lumière couleur : pas encore exposée dans Matter');
		return null;
	}
	const clusters = {onOff: {onOff: this.getOnOffState(Serv)}};
	// every command needs a handler : Homebridge answers a missing one with a failure
	const handlers = {
		onOff: {
			on: () => {this.setLightOnOff(Serv, true);},
			off: () => {this.setLightOnOff(Serv, false);},
			toggle: () => {}, // matter.js toggle() calls on() or off() itself, which reach the handlers above : sending here too would send twice
		},
	};
	let deviceType = Plateform.api.matter.deviceTypes.OnOffLight;
	if (kind != 'onoff') { // every other Matter light has a level
		deviceType = Plateform.api.matter.deviceTypes.DimmableLight;
		Serv.matterHasLevel = true;
		const bright = this.getLightBrightState(Serv);
		if (bright > 0) {Serv.matterLastBright = bright;}
		clusters.levelControl = {
			currentLevel: percentToMatterLevel(Serv.matterLastBright || 100),
			minLevel: MATTER_LEVEL_MIN,
			maxLevel: MATTER_LEVEL_MAX,
		};
		handlers.levelControl = {
			moveToLevel: (request) => {this.setLightLevel(Serv, request ? request.level : null, false);},
			moveToLevelWithOnOff: (request) => {this.setLightLevel(Serv, request ? request.level : null, true);},
			step: (request) => {this.stepLightLevel(Serv, request);},
			// continuous dimming (button held) : matter.js moves its own level, Jeedom gets the brightness again on its next change
			move: () => {},
			stop: () => {},
		};
	}
	if (kind == 'ct') {
		deviceType = Plateform.api.matter.deviceTypes.ColorTemperatureLight;
		Serv.matterHasCt = true;
		const range = this.getLightCtRange(Serv);
		Serv.matterCtRange = range;
		const mireds = this.getLightCtState(Serv);
		clusters.colorControl = {
			colorMode: MATTER_COLOR_MODE_CT,
			enhancedColorMode: MATTER_COLOR_MODE_CT,
			colorTemperatureMireds: clampMireds(mireds === null ? Math.round((range.min + range.max) / 2) : mireds, range),
			colorTempPhysicalMinMireds: range.min,
			colorTempPhysicalMaxMireds: range.max,
			coupleColorTempToLevelMinMireds: range.min,
		};
		handlers.colorControl = {
			moveToColorTemperatureLogic: (request) => {this.setLightCt(Serv, request ? request.colorTemperatureMireds : null);},
			stopAllColorMovement: () => {}, // also called by matter.js before any color mode change : must exist
		};
	}
	Plateform.log('|info','Lumière Matter :',{onoff: 'on/off', dimmable: 'variateur', ct: 'température couleur'}[kind]);
	return buildSensorAccessory(Plateform, eqLogic, Serv, displayName, deviceType, clusters, handlers);
};

// -- getLightCtRange
// -- Desc : Color temperature range (mireds) of a light : the one of its HomeKit ColorTemperature characteristic (from the min/max of Action/Lumière Température Couleur,
// --        converted from Kelvin if needed, HomeKit's 140-500 by default), within what Matter accepts (1-65279)
JeedomMatter.prototype.getLightCtRange = function(Serv) {
	let props;
	try {props = Serv.getCharacteristic(this.Plateform.api.hap.Characteristic.ColorTemperature).props || {};}
	catch {props = {};}
	const min = Math.max(1, Math.round(Number(props.minValue)));
	const max = Math.min(MATTER_MIREDS_MAX, Math.round(Number(props.maxValue)));
	if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {return {min: 140, max: 500};}
	return {min, max};
};

// -- getLightCtState
// -- Desc : Read the current color temperature of a light in mireds (Kelvin already converted by getAccessoryValue), or null
JeedomMatter.prototype.getLightCtState = function(Serv) {
	const mireds = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.ColorTemperature.UUID}, Serv);
	return (typeof mireds === 'number' && Number.isFinite(mireds) && mireds > 0) ? mireds : null;
};

// -- setLightCt
// -- Desc : Change the color temperature (mireds) of a light on behalf of a Matter controller, the same way HomeKit does (Kelvin conversion included)
JeedomMatter.prototype.setLightCt = function(Serv, mireds) {
	const Plateform = this.Plateform;
	if (!Number.isFinite(Number(mireds)) || Number(mireds) <= 0) {return;}
	const value = clampMireds(Number(mireds), Serv.matterCtRange || this.getLightCtRange(Serv));
	Plateform.log('info','[Commande de Matter]','Nom:'+Serv.matterDisplayName+'('+Serv.matterUUID+'):'+value+' mireds');
	Plateform.setAccessoryValue(value, {UUID: Plateform.api.hap.Characteristic.ColorTemperature.UUID}, Serv);
};

// -- pushLightCtState
// -- Desc : Push a color temperature change (mireds) coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter light with color temperature
JeedomMatter.prototype.pushLightCtState = function(Serv, mireds, logMessage) {
	if (!Serv.matterUUID || !Serv.matterHasCt) {return;}
	if (typeof mireds !== 'number' || !Number.isFinite(mireds) || mireds <= 0) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'colorControl', {
		colorTemperatureMireds: clampMireds(mireds, Serv.matterCtRange || this.getLightCtRange(Serv)),
		colorMode: MATTER_COLOR_MODE_CT,
		enhancedColorMode: MATTER_COLOR_MODE_CT,
	}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter colorControl :',err);
	});
};

// -- getLightBrightState
// -- Desc : Read the current brightness (0-100 %) of a light, as seen by Jeedom, or null
JeedomMatter.prototype.getLightBrightState = function(Serv) {
	const percent = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.Brightness.UUID}, Serv);
	return (typeof percent === 'number' && Number.isFinite(percent)) ? percent : null;
};

// -- setLightOnOff
// -- Desc : Turn a light on/off on behalf of a Matter controller, the same way HomeKit does (setAccessoryValue),
// --        except a light without Action/Lumière ON but with a slider : it's turned on at its last known brightness (100 % if none) instead of the maximum
JeedomMatter.prototype.setLightOnOff = function(Serv, value) {
	const Plateform = this.Plateform;
	const Characteristic = Plateform.api.hap.Characteristic;
	Plateform.log('info','[Commande de Matter]','Nom:'+Serv.matterDisplayName+'('+Serv.matterUUID+'):'+value);
	if (value && !Serv.actions.on && Serv.actions.slider) {
		Plateform.setAccessoryValue(Serv.matterLastBright || 100, {UUID: Characteristic.Brightness.UUID}, Serv);
		return;
	}
	Plateform.setAccessoryValue(value, {UUID: Characteristic.On.UUID}, Serv);
};

// -- setLightLevel
// -- Desc : Change the brightness of a light on behalf of a Matter controller (levelControl moveToLevel / moveToLevelWithOnOff)
// -- Params --
// -- level : Matter level 1..254
// -- withOnOff : moveToLevelWithOnOff : the minimum level turns the light off, and a light that is off is turned on.
// --             Like HomeKit (brightness, then On), the Action/Lumière ON is sent after the brightness only if the light is off (the eqLogic options "On after brightness" / "ignore On" keep working).
JeedomMatter.prototype.setLightLevel = function(Serv, level, withOnOff) {
	const Plateform = this.Plateform;
	const Characteristic = Plateform.api.hap.Characteristic;
	const percent = matterLevelToPercent(level);
	if (percent === null) {return;}
	if (withOnOff && level <= MATTER_LEVEL_MIN) {
		this.setLightOnOff(Serv, false);
		return;
	}
	const wasOff = withOnOff && !this.getOnOffState(Serv);
	Plateform.log('info','[Commande de Matter]','Nom:'+Serv.matterDisplayName+'('+Serv.matterUUID+'):'+percent+'%');
	Serv.matterLastBright = percent;
	Plateform.setAccessoryValue(percent, {UUID: Characteristic.Brightness.UUID}, Serv);
	if (wasOff && Serv.actions.on) {
		Plateform.setAccessoryValue(true, {UUID: Characteristic.On.UUID}, Serv);
	}
};

// -- stepLightLevel
// -- Desc : levelControl step (e.g. "increase the brightness") : stepMode 0 = up, 1 = down, stepSize in Matter levels, from the brightness known by Jeedom
JeedomMatter.prototype.stepLightLevel = function(Serv, request) {
	if (!request || !Number.isFinite(Number(request.stepSize))) {return;}
	const current = percentToMatterLevel(Serv.matterLastBright || this.getLightBrightState(Serv) || 0);
	if (current === null) {return;}
	const delta = (request.stepMode == 1 ? -1 : 1) * Number(request.stepSize);
	this.setLightLevel(Serv, Math.min(MATTER_LEVEL_MAX, Math.max(MATTER_LEVEL_MIN, current + delta)), false);
};

// -- pushLightLevelState
// -- Desc : Push a brightness change (0-100 %) coming from Jeedom to the Matter controller; no-op if Serv isn't a dimmable Matter light.
// --        0 % isn't sent (the light is off, onOff carries it) so the level is kept for the next "on"
JeedomMatter.prototype.pushLightLevelState = function(Serv, percent, logMessage) {
	if (!Serv.matterUUID || !Serv.matterHasLevel) {return;}
	if (typeof percent !== 'number' || !(percent > 0)) {return;}
	Serv.matterLastBright = percent;
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'levelControl', {currentLevel: percentToMatterLevel(percent)}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter levelControl :',err);
	});
};

// -- getBatteryCmd / getBatteryService
// -- Desc : In HomeKit the battery is a separate Service; in Matter it is the powerSource cluster of each accessory of the same eqLogic.
// --        getBatteryCmd returns the eqLogic's first BATTERY command (or null), getBatteryService a minimal pseudo-Serv so getAccessoryValue can read it
JeedomMatter.prototype.getBatteryCmd = function(eqLogic) {
	if (!eqLogic || !eqLogic.services || !Array.isArray(eqLogic.services.battery)) {return null;}
	for (const entry of eqLogic.services.battery) {
		if (entry && entry.battery) {return entry.battery;}
	}
	return null;
};
JeedomMatter.prototype.getBatteryService = function(eqLogic, batteryCmd) {
	return {eqID: eqLogic.id, eqLogic: eqLogic, cmd_id: batteryCmd.id, infos: {battery: batteryCmd, batteryCharging: this.getBatteryChargingCmd(eqLogic) || {id: 'NOT'}}};
};
// -- getBatteryChargingCmd
// -- Desc : BATTERY_CHARGING is an optional separate command (own entry in eqLogic.services.battery); null when the eqLogic has none
JeedomMatter.prototype.getBatteryChargingCmd = function(eqLogic) {
	if (!eqLogic || !eqLogic.services || !Array.isArray(eqLogic.services.battery)) {return null;}
	for (const entry of eqLogic.services.battery) {
		if (entry && entry.batteryCharging) {return entry.batteryCharging;}
	}
	return null;
};

// -- getBatteryPercentState / getBatteryChargeLevelState
// -- Desc : Matter powerSource.batPercentRemaining is uint8, double the percentage (0-200, 100% = 200), nullable
// --        Matter powerSource.batChargeLevel enum : 0 = Ok, 1 = Warning, 2 = Critical (HomeKit only knows normal/low, so low = Warning)
// --        batteryServ : pseudo-Serv from getBatteryService
JeedomMatter.prototype.getBatteryPercentState = function(batteryServ) {
	return toBatPercentRemaining(this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.BatteryLevel.UUID}, batteryServ));
};
JeedomMatter.prototype.getBatteryChargeLevelState = function(batteryServ) {
	const Characteristic = this.Plateform.api.hap.Characteristic;
	const val = this.Plateform.getAccessoryValue({UUID: Characteristic.StatusLowBattery.UUID}, batteryServ);
	return (val === Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW) ? 1 : 0;
};
// -- getBatteryChargeState
// -- Desc : batChargeState from the optional BATTERY_CHARGING command; undefined when the eqLogic has none (Homebridge then leaves it at Unknown)
JeedomMatter.prototype.getBatteryChargeState = function(eqLogic, batteryServ) {
	if (!this.getBatteryChargingCmd(eqLogic)) {return undefined;}
	const Characteristic = this.Plateform.api.hap.Characteristic;
	return toBatChargeState(this.Plateform.getAccessoryValue({UUID: Characteristic.ChargingState.UUID}, batteryServ), Characteristic);
};

// -- attachPowerSource
// -- Desc : Add the powerSource cluster to a built Matter accessory when its eqLogic has a battery, and remember the accessory so pushBattery*State can update it.
// --        Every Matter accessory of an eqLogic carries its own copy (each one is a separate tile in the controller).
// --        Homebridge detects the Battery feature from the bat* attributes and advertises the PowerSource device type itself.
// -- Params --
// -- eqLogic : the jeedom eqLogic
// -- accessory : the Matter accessory descriptor built by buildOnOffAccessory/buildSensorAccessory
// -- Return : the same descriptor (untouched when the eqLogic has no battery, scenarios included)
JeedomMatter.prototype.attachPowerSource = function(eqLogic, accessory) {
	const batteryCmd = this.getBatteryCmd(eqLogic);
	if (!batteryCmd) {return accessory;}
	const batteryServ = this.getBatteryService(eqLogic, batteryCmd);
	accessory.clusters.powerSource = {
		status: 1, // PowerSourceStatus.Active
		order: 0,
		description: 'Battery',
		batPercentRemaining: this.getBatteryPercentState(batteryServ),
		batChargeLevel: this.getBatteryChargeLevelState(batteryServ),
		batReplacementNeeded: false,
		batReplaceability: 0, // Unspecified
	};
	const key = String(eqLogic.id);
	const state = {
		percent: accessory.clusters.powerSource.batPercentRemaining === null ? null : accessory.clusters.powerSource.batPercentRemaining / 2,
		charge: this.getBatteryChargeState(eqLogic, batteryServ),
		sent: undefined,
	};
	state.sent = deriveBatChargeState(state.charge, state.percent);
	this.powerSourceState.set(key, state);
	if (state.sent !== undefined) {accessory.clusters.powerSource.batChargeState = state.sent;}
	if (!this.powerSourceTargets.has(key)) {this.powerSourceTargets.set(key, new Map());}
	this.powerSourceTargets.get(key).set(accessory.UUID, accessory.displayName);
	return accessory;
};

// -- pushPowerSourceState
// -- Desc : Push powerSource attributes to every Matter accessory of the battery's eqLogic; no-op if that eqLogic has none
// -- Params --
// -- Serv : the HomeKit Battery service (its eqID identifies the eqLogic)
// -- attributes : partial powerSource state, e.g. {batPercentRemaining: 180}
JeedomMatter.prototype.pushPowerSourceState = function(Serv, attributes, logMessage) {
	const targets = this.powerSourceTargets.get(String(Serv.eqID));
	if (!targets) {return;}
	for (const [uuid, displayName] of targets) {
		this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+displayName);
		this.Plateform.api.matter.updateAccessoryState(uuid, 'powerSource', attributes).catch((err) => {
			this.Plateform.log('error','Erreur de MAJ Matter powerSource :',err);
		});
	}
};
JeedomMatter.prototype.pushBatteryPercentState = function(Serv, value, logMessage) {
	const batPercentRemaining = toBatPercentRemaining(value);
	if (batPercentRemaining === null) {return;}
	const attributes = {batPercentRemaining: batPercentRemaining};
	// crossing the "full" threshold changes the deduced charge state too
	const state = this.powerSourceState.get(String(Serv.eqID));
	if (state) {
		state.percent = batPercentRemaining / 2;
		const batChargeState = deriveBatChargeState(state.charge, state.percent);
		if (batChargeState !== undefined && batChargeState !== state.sent) {
			attributes.batChargeState = batChargeState;
			state.sent = batChargeState;
		}
	}
	this.pushPowerSourceState(Serv, attributes, logMessage);
};
JeedomMatter.prototype.pushBatteryChargeLevelState = function(Serv, value, logMessage) {
	const low = (value === this.Plateform.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
	this.pushPowerSourceState(Serv, {batChargeLevel: low ? 1 : 0}, logMessage);
};
JeedomMatter.prototype.pushBatteryChargeState = function(Serv, value, logMessage) {
	const charge = toBatChargeState(value, this.Plateform.api.hap.Characteristic);
	if (charge === undefined) {return;}
	const state = this.powerSourceState.get(String(Serv.eqID));
	if (state) {state.charge = charge;}
	const batChargeState = deriveBatChargeState(charge, state ? state.percent : null);
	if (state) {state.sent = batChargeState;}
	this.pushPowerSourceState(Serv, {batChargeState: batChargeState}, logMessage);
};

// -- getMatterUUIDs
// -- Desc : UUIDs of the Matter accessories that a HomeKit accessory may have given birth to.
// --        A Matter accessory's UUID is generated from the subtype of its HomeKit service ('matter-' + subtype), and HAP keeps the subtype in its cache,
// --        so it can be recomputed for an accessory restored after a restart. A service that never had a Matter accessory (thermostat, lock...) just gives an unknown UUID.
// -- Params --
// -- hapAccessory : the HomeKit PlatformAccessory (cached or not)
// -- Return : array of UUIDs, without duplicates
JeedomMatter.prototype.getMatterUUIDs = function(hapAccessory) {
	const uuids = new Set();
	if (!hapAccessory || !Array.isArray(hapAccessory.services)) {return [];}
	for (const svc of hapAccessory.services) {
		if (svc && svc.subtype) {uuids.add(this.Plateform.api.hap.uuid.generate('matter-' + svc.subtype));}
	}
	return [...uuids];
};

// -- unregisterForAccessory
// -- Desc : Unregister from Matter what belongs to a HomeKit accessory that is being removed (disabled in Jeedom, or swept by the RAMASSE-MIETTES).
// --        Homebridge ignores an unknown UUID (debug log only) and clears its Matter cache for it, so no need to know which services really were in Matter.
// --        UUIDs built during this run are kept : a renamed accessory or a room change makes the old HomeKit accessory disappear and a new one appear with the same services,
// --        hence the same Matter UUIDs, which must not be removed.
// -- Params --
// -- hapAccessory : the HomeKit accessory being removed (its services are read before it is dropped)
JeedomMatter.prototype.unregisterForAccessory = function(hapAccessory) {
	try {
		const toRemove = this.getMatterUUIDs(hapAccessory).filter((uuid) => !this.activeUUIDs.has(uuid));
		if (!toRemove.length) {return;}
		this.unregisterUUIDs(toRemove, hapAccessory.displayName || '?', (uuid) => truncate32(hapAccessory.displayName || uuid));
	}
	catch(e) {
		this.Plateform.log('error','Erreur de la fonction unregisterForAccessory :',e);
	}
};

// -- unregisterUUIDs
// -- Desc : Unregister Matter accessories from Homebridge by UUID, containing errors (sync or async)
// -- Params --
// -- uuids : non empty array of Matter UUIDs
// -- origin : name used in the log
// -- nameOf : function(uuid) giving the displayName of the descriptor
JeedomMatter.prototype.unregisterUUIDs = function(uuids, origin, nameOf) {
	const Plateform = this.Plateform;
	// only UUID is used by Homebridge, but deviceType must be set (it is read to tell bridged from external accessories)
	const descriptors = uuids.map((uuid) => ({UUID: uuid, displayName: nameOf(uuid), deviceType: Plateform.api.matter.deviceTypes.OnOffOutlet}));
	Plateform.log('info','[Suppression dans Matter]',descriptors.length+' accessoire(s) Matter pour '+origin);
	for (const uuid of uuids) {
		this.forgetPowerSource(uuid);
		this.cachedUUIDs.delete(uuid);
	}
	Plateform.api.matter.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', descriptors).catch((err) => {
		Plateform.log('error','Erreur de la suppression d\'accessoire(s) Matter :',err);
	});
};

// -- rememberCached
// -- Desc : Called by Homebridge (configureMatterAccessory) for each Matter accessory restored from its cache, before the platform launches.
// --        Gives the list of what really exists in Matter, whatever the HomeKit cache still knows.
// -- Params --
// -- accessory : the cached Matter accessory (UUID, displayName...)
JeedomMatter.prototype.rememberCached = function(accessory) {
	if (accessory && accessory.UUID) {this.cachedUUIDs.set(accessory.UUID, accessory.displayName || accessory.UUID);}
};

// -- sweepStaleCached
// -- Desc : Unregister the cached Matter accessories that were not built during this run (service removed from an equipment, equipment removed, old accessory with no HomeKit counterpart anymore).
// --        To call once everything is built and no error occurred (RAMASSE-MIETTES).
// --        Safety : if nothing at all was built while Matter has cached accessories, Jeedom most likely answered empty/failed, so nothing is removed.
JeedomMatter.prototype.sweepStaleCached = function() {
	try {
		const stale = [...this.cachedUUIDs.keys()].filter((uuid) => !this.activeUUIDs.has(uuid));
		if (!stale.length) {return;}
		if (this.activeUUIDs.size === 0) {
			this.Plateform.log('warning','[Matter] Aucun accessoire Matter construit alors que '+stale.length+' sont en cache : aucune suppression Matter par sécurité');
			return;
		}
		this.unregisterUUIDs(stale, 'le cache Matter (plus dans Jeedom)', (uuid) => truncate32(this.cachedUUIDs.get(uuid)));
	}
	catch(e) {
		this.Plateform.log('error','Erreur de la fonction sweepStaleCached :',e);
	}
};

// -- forgetPowerSource
// -- Desc : Drop a removed Matter accessory from the battery push targets (and the eqLogic's battery state once it has none left)
JeedomMatter.prototype.forgetPowerSource = function(uuid) {
	for (const [eqId, targets] of this.powerSourceTargets) {
		if (targets.delete(uuid) && targets.size === 0) {
			this.powerSourceTargets.delete(eqId);
			this.powerSourceState.delete(eqId);
		}
	}
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
