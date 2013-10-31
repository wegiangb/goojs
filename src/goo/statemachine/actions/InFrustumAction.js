define([
	'goo/statemachine/actions/Action',
	'goo/renderer/Camera',
	'goo/renderer/bounds/BoundingSphere'
],
/** @lends */
function(
	Action,
	Camera,
	BoundingSphere
) {
	'use strict';

	function InFrustumAction(/*id, settings*/) {
		Action.apply(this, arguments);
	}

	InFrustumAction.prototype = Object.create(Action.prototype);
	InFrustumAction.prototype.constructor = InFrustumAction;

	InFrustumAction.external = {
		name: 'In Frustum',
		description: 'Performs a transition based on whether the entity is in a camera\'s frustum or not',
		canTransition: true,
		parameters: [{
			name: 'Current camera',
			key: 'current',
			type: 'boolean',
			description: 'Check this to always use the current camera',
			'default': true
		}, {
			name: 'Camera',
			key: 'cameraEntityRef',
			type: 'cameraEntity',
			description: 'Other camera; Will be ignored if the previous option is checked',
			'default': null
		}, {
			name: 'On every frame',
			key: 'everyFrame',
			type: 'boolean',
			description: 'Repeat this action every frame',
			'default': true
		}],
		transitions: [{
			key: 'inside',
			name: 'Inside',
			description: 'State to transition to if entity is in the frustum'
		}, {
			key: 'outside',
			name: 'Outside',
			description: 'State to transition to if entity is outside the frustum'
		}]
	};

	InFrustumAction.prototype._setup = function (fsm) {
		if (!this.current) {
			var world = fsm.getOwnerEntity()._world;
			var cameraEntity = world.entityManager.getEntityByName(this.cameraEntityRef);
			this.camera = cameraEntity.cameraComponent.camera;
		}
	};

	InFrustumAction.prototype._run = function (fsm) {
		var entity = fsm.getOwnerEntity();

		if (this.current) {
			if (entity.isVisible) {
				fsm.send(this.transitions.inside);
			} else {
				fsm.send(this.transitions.outside);
			}
		} else {
			var boundingVolume = entity.meshDataComponent ? entity.meshDataComponent.modelBound : new BoundingSphere(entity.transformComponent.worldTransform.translation, 0.001);
			if (this.camera.contains(boundingVolume) === Camera.Outside) {
				fsm.send(this.transitions.outside);
			} else {
				fsm.send(this.transitions.inside);
			}
		}
	};

	return InFrustumAction;
});