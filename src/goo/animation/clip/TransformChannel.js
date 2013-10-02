define([
	'goo/animation/clip/AbstractAnimationChannel',
	'goo/animation/clip/TransformData',
	'goo/math/Quaternion',
	'goo/math/Vector3',
	'goo/animation/clip/LinearInterpolator',
	'goo/animation/clip/HermiteInterpolator'
	],
/** @lends */
function (
	AbstractAnimationChannel,
	TransformData,
	Quaternion,
	Vector3,
	LinearInterpolator,
	HermiteInterpolator
	) {
	"use strict";

	function getStructuredArray(data) {
		var ret = [];
		if (!data) return ret;

		for (var i = 0; i < data.length; i += 4) {
			ret.push({
				time: data[i],
				value: data[i + 1],
				tangentIn: data[i + 2],
				tangentOut: data[i + 3]
			});
		}

		return ret;
	}

	/**
	 * @class An animation channel consisting of a series of transforms interpolated over time.
	 * @param channelName our name.
	 * @param {Array} times our time offset values.
	 * @param {Array} rotations the rotations to set on this channel at each time offset.
	 * @param {Array} translations the translations to set on this channel at each time offset.
	 * @param {Array} scales the scales to set on this channel at each time offset.
	 */

	function TransformChannel (channelName, translationX, translationY, translationZ, rotationX, rotationY, rotationZ, rotationW, scaleX, scaleY, scaleZ, blendType) {
		AbstractAnimationChannel.call(this, channelName, []/*times*/, blendType);

		var interpolator = TransformChannel._interpolators[blendType.toLowerCase()];

		if (translationX && translationX.length) { this._translationX = new interpolator(getStructuredArray(translationX)); }
		if (translationY && translationY.length) { this._translationY = new interpolator(getStructuredArray(translationY)); }
		if (translationZ && translationZ.length) { this._translationZ = new interpolator(getStructuredArray(translationZ)); }

		if (rotationX && rotationX.length) { this._rotationX = new interpolator(getStructuredArray(rotationX)); }
		if (rotationY && rotationX.length) { this._rotationY = new interpolator(getStructuredArray(rotationY)); }
		if (rotationZ && rotationX.length) { this._rotationZ = new interpolator(getStructuredArray(rotationZ)); }
		if (rotationW && rotationX.length) { this._rotationW = new interpolator(getStructuredArray(rotationW)); }

		if (scaleX && scaleX.length) { this._scaleX = new interpolator(getStructuredArray(scaleX)); }
		if (scaleY && scaleX.length) { this._scaleY = new interpolator(getStructuredArray(scaleY)); }
		if (scaleZ && scaleX.length) { this._scaleZ = new interpolator(getStructuredArray(scaleZ)); }
	}

	TransformChannel.prototype = Object.create(AbstractAnimationChannel.prototype);

	TransformChannel._interpolators = {
		linear: LinearInterpolator,
		hermite: HermiteInterpolator
	};

	/**
	 * Creates a data item for this type of channel
	 * @returns {TransformData}
	 */
	TransformChannel.prototype.createStateDataObject = function () {
		return new TransformData();
	};

	TransformChannel.prototype.setDefaultData = function (transform) {
		if (!this._translationX) { this._translationXDefault = transform.translation.data[0]; }
		if (!this._translationY) { this._translationYDefault = transform.translation.data[1]; }
		if (!this._translationZ) { this._translationZDefault = transform.translation.data[2]; }

		var rotationQuaternion = Quaternion.fromMatrix(transform.rotation);
		if (!this._rotationX) { this._rotationXDefault = rotationQuaternion.data[0]; }
		if (!this._rotationY) { this._rotationYDefault = rotationQuaternion.data[1]; }
		if (!this._rotationZ) { this._rotationZDefault = rotationQuaternion.data[2]; }
		if (!this._rotationW) { this._rotationWDefault = rotationQuaternion.data[3]; }

		if (!this._scaleX) { this._scaleXDefault = transform.scale.data[0]; }
		if (!this._scaleY) { this._scaleYDefault = transform.scale.data[1]; }
		if (!this._scaleZ) { this._scaleZDefault = transform.scale.data[2]; }
	};

	TransformChannel.prototype.getMaxTime = function () {
		return Math.max(
			this._translationX ? this._translationX.getMaxTime() : 0,
			this._translationY ? this._translationY.getMaxTime() : 0,
			this._translationZ ? this._translationZ.getMaxTime() : 0,
			this._rotationX ? this._rotationX.getMaxTime() : 0,
			this._rotationY ? this._rotationY.getMaxTime() : 0,
			this._rotationZ ? this._rotationZ.getMaxTime() : 0,
			this._rotationW ? this._rotationW.getMaxTime() : 0,
			this._scaleX ? this._scaleX.getMaxTime() : 0,
			this._scaleY ? this._scaleY.getMaxTime() : 0,
			this._scaleZ ? this._scaleZ.getMaxTime() : 0
		);
	};

	/**
	 * Applies the channels animation state to supplied data item
	 * @param {number} sampleIndex
	 * @param {number} fraction
	 * @param {TransformData} value The data item to apply animation to
	 */
	TransformChannel.prototype.setCurrentSample = function (sampleIndex, fraction, applyTo, time) {
		var transformData = applyTo;

		// --- translation ---
		if (this._translationX) {
			transformData._translation.data[0] = this._translationX.getAt(time);
		} else {
			transformData._translation.data[0] = this._translationXDefault;
		}

		if (this._translationY) {
			transformData._translation.data[1] = this._translationY.getAt(time);
		} else {
			transformData._translation.data[1] = this._translationYDefault;
		}

		if (this._translationZ) {
			transformData._translation.data[2] = this._translationZ.getAt(time);
		} else {
			transformData._translation.data[2] = this._translationZDefault;
		}

		// --- rotation ---
		if (this._rotationX) {
			transformData._rotation.data[0] = this._rotationX.getAt(time);
		} else {
			transformData._rotation.data[0] = this._rotationXDefault;
		}

		if (this._rotationY) {
			transformData._rotation.data[1] = this._rotationY.getAt(time);
		} else {
			transformData._rotation.data[1] = this._rotationYDefault;
		}

		if (this._rotationZ) {
			transformData._rotation.data[2] = this._rotationZ.getAt(time);
		} else {
			transformData._rotation.data[2] = this._rotationZDefault;
		}

		if (this._rotationW) {
			transformData._rotation.data[3] = this._rotationW.getAt(time);
		} else {
			transformData._rotation.data[3] = this._rotationWDefault;
		}

		transformData._rotation.normalize();

		// --- scale ---
		if (this._scaleX) {
			transformData._scale.data[0] = this._scaleX.getAt(time);
		} else {
			transformData._scale.data[0] = this._scaleXDefault;
		}

		if (this._scaleY) {
			transformData._scale.data[1] = this._scaleY.getAt(time);
		} else {
			transformData._scale.data[1] = this._scaleYDefault;
		}

		if (this._scaleZ) {
			transformData._scale.data[2] = this._scaleZ.getAt(time);
		} else {
			transformData._scale.data[2] = this._scaleZDefault;
		}
	};

	/**
	 * Apply a specific index of this channel to a {@link TransformData} object.
	 * @param {number} index the index to grab.
	 * @param {TransformData} [store] the TransformData to store in. If null, a new one is created.
	 * @return {TransformData} our resulting TransformData.
	 */
	TransformChannel.prototype.getData = function (index, store) {
		var rVal = store ? store : new TransformData();
		rVal.setRotation(this._rotations[index]);
		rVal.setScale(this._scales[index]);
		rVal.setTranslation(this._translations[index]);
		return rVal;
	};

	return TransformChannel;
});