'use strict';

var Q = require('q'),
	_ = require('lodash'),
	ccBnp = require('ccbnp');

var Char = require('./characteristic'),
	bledb = require('./bledb'),
	bleutil = require('../util/bleutil'),
	BDEFS = require('../defs/bledefs'),
	GATTDEFS = require('../defs/gattdefs');

function Service (servInfo) {
	this._id = null;
	this._isSync = false;

	this.ownerDev = null;
	this.uuid = servInfo.uuid;
	this.startHdl = servInfo.startHdl;
	this.endHdl = servInfo.endHdl;
	this.name = null;
	this.chars = {};

	if (GATTDEFS.ServUuid.get(this.uuid)) { this.name = GATTDEFS.ServUuid.get(this.uuid).key; }
}

Service.prototype.getChars = function (callback) {
	var self = this,
		deferred = Q.defer(),
		charObj,
		charsInfo = [],
		characteristic,
        readCharValFuncs = [];

	ccBnp.gatt.discAllChars(this.ownerDev.connHdl, this.startHdl, this.endHdl).then(function (result) {
		_.forEach(result[1], function (evtObj) {
            if (evtObj.status === 0) { 
            	charObj = evtObj.data; 
                for (var i = 0; i < (_.keys(charObj).length / 2); i += 1) {
                    var uuid = '0x';
                    for(var j = charObj['attrVal' + i].length; j > 3; j -= 1) {
                        if (charObj['attrVal' + i][j - 1] <= 15) {
                            uuid += '0' + charObj['attrVal' + i][j - 1].toString(16);
                        } else {
                            uuid += charObj['attrVal' + i][j - 1].toString(16);
                        }
                    }
                    charsInfo.push({
                        prop: charObj['attrVal' + i].readUInt8(),
                        hdl: charObj['attrVal' + i].readUInt16LE(1),
                        uuid: uuid
                    });
                }
            }
        });

		_.forEach(charsInfo, function (charInfo) {
			var charName;

			if ( charInfo.uuid.length ===  34) {
				charName = '0x' + charInfo.uuid.slice(6, 10);
			} else {
				charName = charInfo.uuid;
			}
			characteristic = new Char(charInfo);
			characteristic.ownerServ = self;
			self.chars[charName] = characteristic;
			if (GATTDEFS.Prop.get('Read').value & characteristic.prop) {
				readCharValFuncs.push(characteristic.read.bind(characteristic));
			}
		});
		return bleutil.seqResolveQFuncs(readCharValFuncs);
	}).then(function () {
		deferred.resolve();
	}).fail(function (err) {
		deferred.reject(err);
	});

	return deferred.promise.nodeify(callback);
};

Service.prototype.expInfo = function () {
	var chars = [];

	_.forEach(this.chars, function (char) {
		chars.push(char.uuid);
	});

	return {
		owner: this.ownerDev._id,
		uuid: this.uuid,
		startHdl: this.startHdl,
		endHdl: this.endHdl,
		chars: chars
	};
};

Service.prototype.loadChars = function (callback) {
	var self = this,
		deferred = Q.defer(),
		char;

	bledb.getInfo('characteristic').then(function (charsInfo) {
		charsInfo = _.filter(charsInfo, function (charInfo) {
			return _.isEqual(charInfo.owner, self._id);
		});

		_.forEach(charsInfo, function (charInfo) {
			char = new Char(charInfo);
			char.ownerServ = self;
			char._id = charInfo._id;
			//TODO
			// char.val = charInfo.val;
			if (charInfo.val) { char.val = new Buffer(charInfo.val.data); }
			if (charInfo.uuid.length === 34) { charInfo.uuid = '0x' + charInfo.uuid.slice(6, 10); }
			self.chars[charInfo.uuid] = char;
		});

		deferred.resolve();
	}).fail(function (err) {
		deferred.reject(err);
	}).done();

	return deferred.promise.nodeify(callback);
};

Service.prototype.update = function (callback) {
    var deferred = Q.defer(),
        updateCharFuncs = [];

    _.forEach(this.chars, function (char) {
        updateCharFuncs.push(char.update.bind(char));
    });
    bleutil.seqResolveQFuncs(updateCharFuncs).then(function (result) {
        deferred.resolve(result);
    }).fail(function (err) {
        deferred.reject(err);
    }).done();

    return deferred.promise.nodeify(callback);
};

Service.prototype.save = function (callback) {
	var self = this,
		deferred = Q.defer(),
		servInfo = this.expInfo(),
		saveCharFuncs = [];

	bledb.saveServInfo(servInfo).then(function (doc) {
		self._id = doc._id;
		_.forEach(self.chars, function (char) {
			saveCharFuncs.push(char.save.bind(char));
		});
		return bleutil.seqResolveQFuncs(saveCharFuncs);
	}).then(function (result) {
		self._isSync = true;
		deferred.resolve(result);
	}).fail(function (err) {
		self._isSync = false;
		deferred.reject(err);
	}).done();

	return deferred.promise.nodeify(callback);
};

Service.prototype.remove = function () {

};

module.exports = Service;