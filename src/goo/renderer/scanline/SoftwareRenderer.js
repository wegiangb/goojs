define([
	'goo/renderer/Camera',
	'goo/renderer/scanline/Triangle',
	'goo/math/Vector2',
	'goo/math/Vector3',
	'goo/math/Vector4',
	'goo/math/Matrix4x4',
	'goo/renderer/scanline/Edge',
	'goo/renderer/bounds/BoundingSphere',
	'goo/renderer/bounds/BoundingBox',
    'goo/renderer/scanline/EdgeData',
    'goo/renderer/scanline/BoundingBoxOcclusionModule',
    'goo/renderer/scanline/BoundingSphereOcclusionModule'
	],
	/** @lends */

	function (Camera, Triangle, Vector2, Vector3, Vector4, Matrix4x4, Edge, BoundingSphere, BoundingBox, EdgeData, BoundingBoxOcclusionModule, BoundingSphereOcclusionModule) {
	    "use strict";

        /**
        *	@class A software renderer able to render triangles to a depth buffer (w-buffer). Occlusion culling is also performed in this class.
        *	@constructor
        *	@param {{width:Number, height:Number, camera:Camera}} parameters A JSON object which has to contain width, height and the camera object to be used.
        */
        function SoftwareRenderer (parameters) {
            parameters = parameters || {};

            this.width = parameters.width;
            this.height = parameters.height;

            this._clipY = this.height - 1;
            this._clipX = this.width - 1;

            this.camera = parameters.camera;

            // Pre-allocate memory for the edges.
            this._edges = new Array(3);

            var numOfPixels = this.width * this.height;

            var colorBytes = numOfPixels * 4 * Uint8Array.BYTES_PER_ELEMENT;
            var depthBytes = numOfPixels * Float32Array.BYTES_PER_ELEMENT;

            this._frameBuffer = new ArrayBuffer(colorBytes + depthBytes * 2);

            // The color data is used for debugging purposes.
            this._colorData = new Uint8Array(this._frameBuffer, 0, numOfPixels * 4);
            this._depthData = new Float32Array(this._frameBuffer, colorBytes, numOfPixels);
            // Buffer for clearing.
            this._depthClear = new Float32Array(this._frameBuffer, colorBytes + depthBytes, numOfPixels);

            //Initialize the clear buffer
            for (var i = 0; i < numOfPixels; i++) {
                this._depthClear[i] = 0.0;
            }

            this.boundingBoxModule = new BoundingBoxOcclusionModule(this);
            this.boundingSphereModule = new BoundingSphereOcclusionModule(this);
        }

        /**
        *	Clears the depth data.
        */
        SoftwareRenderer.prototype._clearDepthData = function () {

            this._depthData.set(this._depthClear);
        };

        /**
        *	Renders z-buffer (w-buffer) from the given renderList of entities with OccluderComponents.
        *
        *	@param {Array.<Entity>} renderList The array of entities with attached OccluderComponents.
        */
        SoftwareRenderer.prototype.render = function (renderList) {

            this._clearDepthData();

            var cameraViewMatrix = this.camera.getViewMatrix();
            var cameraProjectionMatrix = this.camera.getProjectionMatrix();

            // Iterates over the view frustum culled entities and draws them one entity at a time.
            for ( var i = 0; i < renderList.length; i++) {
                var triangles = this._createTrianglesForEntity(renderList[i], cameraViewMatrix, cameraProjectionMatrix);

                for (var t = 0; t < triangles.length; t++) {
                    this._renderTriangle(triangles[t]);
                }
            }
        };

        /**
        * Performs occlusion culling for the given array of Entities. A new array is returned with the visibile Entities.
        *	@param {Array.<Entity>} renderList The array of entities which are possible occludees.
        *  @returns {Array.<Entity>} visibleEntities The array of entities which are visible after occlusion culling has been applied.
        */
        SoftwareRenderer.prototype.performOcclusionCulling = function (renderList) {

            var cameraViewMatrix = this.camera.getViewMatrix();
            var cameraProjectionMatrix = this.camera.getProjectionMatrix();
            var cameraViewProjectionMatrix = Matrix4x4.combine(cameraProjectionMatrix, cameraViewMatrix);
            var cameraNearZInWorld = -this.camera.near;
            var visibleEntities = [];

            for (var i = 0; i < renderList.length; i++) {
                var entity = renderList[i];
                if (entity.meshRendererComponent.cullMode !== 'NeverOcclusionCull') {

                    var cull;

                    if (entity.meshDataComponent.modelBound instanceof BoundingSphere) {
                        cull = this.boundingSphereModule.occlusionCull(entity, cameraViewMatrix, cameraProjectionMatrix, cameraNearZInWorld);
                    } else if (entity.meshDataComponent.modelBound instanceof BoundingBox) {
                        cull = this.boundingBoxModule.occlusionCull(entity, cameraViewProjectionMatrix);
                    }

                    if (!cull) {
                        visibleEntities.push(entity);
                    }
                } else {
                    visibleEntities.push(entity);
                }
            }

            return visibleEntities;
        };


        /**
        *	Creates an array of the visible {Triangle} for the entity
        *	@param {Entity} entity, the entity from which to create triangles.
        *	@return {Array.<Triangle>} triangle array
        *   @param cameraProjectionMatrix
        *   @param cameraViewMatrix
        */
        SoftwareRenderer.prototype._createTrianglesForEntity = function (entity, cameraViewMatrix, cameraProjectionMatrix) {

            var originalPositions = entity.occluderComponent.meshData.dataViews.POSITION;
            var vertIndexArray = entity.occluderComponent.meshData.indexData.data;

            // Allocate the triangle array for the maximum case,
            // where all the triangles are visible.
            // This will raise a need for checking for undefined during the rendering of the triangles.
            var triangles = [];

            var entitityWorldTransformMatrix = entity.transformComponent.worldTransform.matrix;
            var cameraNearZInWorld = -this.camera.near;

            // Combine the entity world transform and camera view matrix, since nothing is calculated between these spaces
            var combinedMatrix = Matrix4x4.combine(cameraViewMatrix, entitityWorldTransformMatrix);

            var posArray = new Float32Array(originalPositions.length);
            var tempVertex = Vector4.UNIT_W;
            // Transform vertices to camera view space beforehand to not transform several times on a vertex. ( up to three times ).
            // The homogeneous coordinate,w , will not be altered during this transformation. And remains 1.0.
            for (var i = 0; i < posArray.length; i++) {
                tempVertex.seta([originalPositions[i], originalPositions[i + 1], originalPositions[i + 2], 1.0]);
                combinedMatrix.applyPost(tempVertex);
                posArray.set([tempVertex.data[0], tempVertex.data[1], tempVertex.data[2]], i);
                i += 2;
            }

            for (var vertIndex = 0; vertIndex < vertIndexArray.length; vertIndex++ ) {

                var posIndex = vertIndexArray[vertIndex] * 3;
                var v1 = new Vector4(posArray[posIndex], posArray[posIndex + 1], posArray[posIndex + 2], 1.0);

                posIndex = vertIndexArray[++vertIndex] * 3;
                var v2 = new Vector4(posArray[posIndex], posArray[posIndex + 1], posArray[posIndex + 2], 1.0);

                posIndex = vertIndexArray[++vertIndex] * 3;
                var v3 = new Vector4(posArray[posIndex], posArray[posIndex + 1], posArray[posIndex + 2], 1.0);

                var vertices = [v1, v2, v3];

                if (this._isBackFacingCameraViewSpace(v1, v2, v3)) {
                    continue; // Skip loop to the next three vertices.
                }

                // Clip triangle to the near plane.

                // Outside indices are the vertices which are outside the view frustum,
                // that is closer than the near plane in this case.
                // The inside indices are the ones on the inside.
                var outsideIndices = [];
                var insideIndices = [];

                this._categorizeVertices(outsideIndices, insideIndices, vertices, cameraNearZInWorld);

                switch (outsideIndices.length) {
                    case 0:
                        // All vertices are on the inside. Continue as usual.
                        break;
                    case 3:
                        // All of the vertices are on the outside, skip to the next three vertices.
                        // TODO : Refactor to remove continue statement. acoording to Javascript : The Good Parts.
                        continue;
                    case 1:
                        // Update the one vertex to its new position on the near plane and add a new vertex
                        // on the other intersection with the plane.

                        // TODO: Small optimization, the origin.z + near calculation in intersectionratio()
                        // 		 can be performed once here instead of twice.

                        var origin = vertices[outsideIndices[0]];
                        var target = vertices[insideIndices[0]];
                        var ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

                        var newV1 = [
                            origin.data[0] + ratio * (target.data[0] - origin.data[0]),
                            origin.data[1] + ratio * (target.data[1] - origin.data[1]),
                            origin.data[2] + ratio * (target.data[2] - origin.data[2])
                        ];

                        target = vertices[insideIndices[1]];
                        ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

                        var newV2 = new Vector4(
                            origin.data[0] + ratio * (target.data[0] - origin.data[0]),
                            origin.data[1] + ratio * (target.data[1] - origin.data[1]),
                            origin.data[2] + ratio * (target.data[2] - origin.data[2]),
                            1.0
                        );
                        // Set the new data for the origin vertex.
                        vertices[outsideIndices[0]].data[0] = newV1[0];
                        vertices[outsideIndices[0]].data[1] = newV1[1];
                        vertices[outsideIndices[0]].data[2] = newV1[2];

                        vertices.push(newV2);

                        break;
                    case 2:
                        // Update the two outside vertices to their new positions on the near plane.
                        // First vertex update
                        var origin = vertices[outsideIndices[0]];
                        var target = vertices[insideIndices[0]];

                        var ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

                        origin.data[0] += ratio * (target.data[0] - origin.data[0]);
                        origin.data[1] += ratio * (target.data[1] - origin.data[1]);
                        origin.data[2] += ratio * (target.data[2] - origin.data[2]);


                        // Second vertex update
                        origin = vertices[outsideIndices[1]];
                        ratio = this._calculateIntersectionRatio(origin, target, this.camera.near);

                        origin.data[0] += ratio * (target.data[0] - origin.data[0]);
                        origin.data[1] += ratio * (target.data[1] - origin.data[1]);
                        origin.data[2] += ratio * (target.data[2] - origin.data[2]);

                        break;
                }

                // TODO : Combine projection + screen space transformations.
                this._projectionTransform(vertices, cameraProjectionMatrix);

                /*
                if (this._isBackFacingProjected(v1, v2, v3)) {
                    // TODO : Refactor to remove continue statement. according to Javascript : The Good Parts.
                    continue; // Skip loop to the next three vertices.
                }
                */

                this._transformToScreenSpace(vertices);

                this._createTriangles(vertices, outsideIndices, insideIndices, triangles);
            }

            return triangles;
        };

        /**
        *	Transforms the vertices with the given projection transform matrix and then performs the homogeneous division.
        *
        *	@param {Array.<Vector4>} vertices The vertex array
        *	@param {Matrix4x4} matrix The projection transformation matrix
        */
        SoftwareRenderer.prototype._projectionTransform = function (vertices, matrix) {

            for (var i = 0; i < vertices.length; i++) {
                var v = vertices[i];

                matrix.applyPost(v);

                var div = 1.0 / v.w;
                v.x *= div;
                v.y *= div;
            }
        };

        /**
        *	Adds new triangle(s) to the triangle array. If the triangle has been clipped , the triangles are created from the vertex array in combination with the
        *	outsideIndices and insideIndices.
        *
        *	@param {Array.<Vector4>} vertices vertex array
        *	@param {Array.<Number>} outsideIndices
        *	@param {Array.<Number>} insideIndices
        *	@param {Array.<Triangle>} triangles the array to hold the created triangles.
        */
        SoftwareRenderer.prototype._createTriangles = function (vertices, outsideIndices, insideIndices, triangles) {

            if (vertices.length === 4) {
                // The vertex array has a length 4 only if one of the vertices were outside the near plane.
                // The "extra vertex" is at position 3 in the array.

                // The order of the triangle is not relevant here anymore since
                // the backface culling check is made already.
                triangles.push(new Triangle(vertices[outsideIndices[0]], vertices[insideIndices[0]], vertices[3]));
                triangles.push(new Triangle(vertices[3], vertices[insideIndices[0]], vertices[insideIndices[1]]));

            } else {
                triangles.push(new Triangle(vertices[0], vertices[1], vertices[2]));
            }
        };

        /**
        *	Categorizes the vertices into outside and inside (of the view frustum).
        *	A vertex is categorized as being on the inside of the view frustum if it is located on the near plane.
        *	The outside- and insideIndices arrays are populated with the index to the vertex in question.
        *	@param {Array.<Number>} outsideIndices
        *	@param {Array.<Number>} insideIndices
        *	@param {Array.<Number>} vertices
        *   @param cameraNear
        */
        SoftwareRenderer.prototype._categorizeVertices = function (outsideIndices, insideIndices, vertices, cameraNear) {

            for ( var i = 0; i < 3; i++ ) {
                // The vertex shall be categorized as an inside vertex if it is on the near plane.
                if (vertices[i].z <= cameraNear) {
                    insideIndices.push(i);
                } else {
                    outsideIndices.push(i);
                }
            }
        };

        /**
        *	Calculates the intersection ratio between the vector, created from the parameters origin and target, with the camera's near plane.
        *
        *	The ratio is defined as the amount (%), of the vector from origin to target, where the vector's intersection
        *	with the near plane happens.
        *
        *	Due to this intersection being performed in camera space, the ratio calculation can be simplified to
        *	only account for the z-coordinates.
        *
        *	@param {Vector3} origin
        *	@param {Vector3} target
        *	@param {Number} near The near plane.
        */
        SoftwareRenderer.prototype._calculateIntersectionRatio = function (origin, target, near) {

            // Using a tip from Joel:
            // The intersection ratio can be calculated using the respective lenghts of the
            // endpoints (origin and target) to the near plane.
            // http://www.joelek.se/uploads/files/thesis.pdf, pages 28-31.

            // The camera's near plane component is the translation of the near plane,
            // therefore 'a' is calculated as origin.z + near
            // var a = origin.z + near;
            // var b = -near - target.z;
            // var ratio = a/(a+b);

            // Simplified the ratio to :
            return (origin.data[2] + near) / (origin.data[2] - target.data[2]);

        };

        /**
        *	Transforms the vertices' x and y coordinates into pixel coordinates of the screen.
        *	// TODO : This function should not be used in prod, rather combine the projection transform and this one.
        *	@param {Array.<Vector4>} vertices the vertices to be transformed.
        */
        SoftwareRenderer.prototype._transformToScreenSpace = function (vertices) {

            for (var i = 0; i < vertices.length; i++) {

                var vertex = vertices[i];

                // These calculations assume that the camera's viewPortRight and viewPortTop are 1,
                // while the viewPortLeft and viewPortBottom are 0.
                // The x and y coordinates can still be outside the screen space here, but those will be clipped during rasterizing.
                // Transform to zerobasd interval of pixels instead of [0, width] which will be one pixel too much.
                // (Assuming the vertex values range from [-1, 1] when projected.)
                vertex.data[0] = (vertex.data[0] + 1.0) * (this._clipX / 2);
                vertex.data[1] = (vertex.data[1] + 1.0) * (this._clipY / 2);

                // http://www.altdevblogaday.com/2012/04/29/software-rasterizer-part-2/
                // The w-coordinate is the z-view at this point. Ranging from [0, cameraFar<].
                // During rendering, 1/w is used and saved as depth (float32). Values further than the far plane will render correctly.
            }
        };

        /**
        *	Determines if a triangle is backfacing in camera view space.
        *
        *	@param {Vector4} v1 Vertex #1
        *	@param {Vector4} v3 Vertex #2
        *	@param {Vector4} v3 Vertex #3
        *	@return {Boolean} true or false
        */
        SoftwareRenderer.prototype._isBackFacingCameraViewSpace = function (v1, v2, v3) {

            // Calculate the dot product between the triangle's face normal and the camera's eye direction
            // to find out if the face is facing away or not.

            // Create edges for calculating the normal.
            var e1 = [v2.data[0] - v1.data[0] , v2.data[1] - v1.data[1], v2.data[2] - v1.data[2]];
            var e2 = [v3.data[0] - v1.data[0], v3.data[1] - v1.data[1], v3.data[2] - v1.data[2]];

            // Doing the cross as well as dot product here since the built-in methods in Vector3 seems to do much error checking.
            var faceNormal = new Array(3);
            faceNormal[0] = e2[2] * e1[1] - e2[1] * e1[2];
            faceNormal[1] = e2[0] * e1[2] - e2[2] * e1[0];
            faceNormal[2] = e2[1] * e1[0] - e2[0] * e1[1];

            // Picking the first vertex as the point on the triangle to evaulate the dot product on.
            //var viewVector = [v1.x, v1.y, v1.z];

            // No need to normalize the vectors due to only being
            // interested in the sign of the dot product.

            /*
            // Normalize faceNormal and view vector
            var viewLength = Math.sqrt(viewVector[0] * viewVector[0] + viewVector[1] * viewVector[1] + viewVector[2] * viewVector[2]);
            var faceLength = Math.sqrt(faceNormal[0] * faceNormal[0] + faceNormal[1] * faceNormal[1] + faceNormal[2] * faceNormal[2]);

            for (var i = 0; i < 3; i++) {
                viewVector[i] /= viewLength;
                faceNormal[i] /= faceLength;
            }
            */

            var dot = faceNormal[0] * v1.data[0] + faceNormal[1] * v1.data[1] + faceNormal[2] * v1.data[2];
            return dot > 0.0;
        };

        /**
        *	Returns true if the (CCW) triangle created by the vertices v1, v2 and v3 is facing backwards.
        *	Otherwise false is returned. This method is for checking projected vertices.
        *
        *	@param {Vector4} v1 Vertex #1
        *	@param {Vector4} v2 Vertex #2
        *	@param {Vector4} v3 Vertex #3
        *	@return {Boolean} true or false
        */
        SoftwareRenderer.prototype._isBackFacingProjected = function (v1, v2, v3) {

            // Optimized away edge allocation , only need x and y of the edges.
            var e1X = v2.data[0] - v1.data[0];
            var e1Y = v2.data[1] - v1.data[1];

            var e2X = v3.data[0] - v1.data[0];
            var e2Y = v3.data[1] - v1.data[1];

            var faceNormalZ = e2Y * e1X - e2X * e1Y;

            // The cameras eye direction will always be [0,0,-1] at this stage
            // (the vertices are transformed into the camera's view projection space,
            // thus the dot product can be simplified to only do multiplications on the z component.

            // var dotProduct = -faceNormal.z; // -1.0 * faceNormal.z;

            // The face is facing backwards if the dotproduct is positive.
            // Invert the comparison to remove the negation of facenormalZ.
            return faceNormalZ < 0.0;
        };

        /**
        *	Creates the new edges from the triangle. The returned value will be false if the triangle is outside view,
        *	otherwise the returned value is an array with the indices.
        *	@return {Array.<Number>} edgeIndexArray [longEdge, shortedge1, shortedge2, longEdgeIsOnTheRightSide]
        */
        SoftwareRenderer.prototype._createEdgesForTriangle = function (triangle) {
            this._edges = [
                new Edge(triangle.v1, triangle.v2),
                new Edge(triangle.v2, triangle.v3),
                new Edge(triangle.v3, triangle.v1)
            ];

            var maxHeight = 0;
            var longEdge = 0;

            // Find edge with the greatest height in the Y axis, this is the long edge.
            for(var i = 0; i < 3; i++) {
                var height = this._edges[i].y1 - this._edges[i].y0;
                if(height > maxHeight) {
                    maxHeight = height;
                    longEdge = i;
                }
            }

            // "Next, we get the indices of the shorter edges, using the modulo operator to make sure that we stay within the bounds of the array:"
            var shortEdge1 = (longEdge + 1) % 3;
            var shortEdge2 = (longEdge + 2) % 3;

            return [longEdge, shortEdge1, shortEdge2];
        };

            /**
             * Returns an array containing if the triangle's long edge is on the right or left and if the triangle is leaning inwards or outwards
             * @param {EdgeData} edgeData
             * @param shortEdge
             * @param longEdge
             * @returns {Array}
             * @private
             */
        SoftwareRenderer.prototype._calculateOrientationData = function (edgeData, shortEdge, longEdge) {

            var shortX = edgeData.getShortX();
            var longX = edgeData.getLongX();

            // If the edges start at the same position (floating point comparison),
            // The edges will most probably contain an integer index to the vertex array in future optimizations.
            // the long edge can be determined by examining the slope sign.
            // Otherwise, just check which one is larger.

            // A triangle is leaning inwards, if the long edge's stop vertex is further away than the vertex to compare with of the short edge.
            // The depth values have been inverted, so the comparison has to be inverted as well.
            if (shortX === longX) {
                // The short edge is the upper one. The long and short edges originate from the same vertex.
                return [edgeData.getLongXIncrement() > edgeData.getShortXIncrement(), longEdge.z1 < shortEdge.z1];
            } else {
                // The short edge is the bottom one.
                return [longX > shortX, longEdge.z1 < shortEdge.z0];
            }
        };

        /**
        *	Returns true if the triangle is occluded.
        */
        SoftwareRenderer.prototype.isRenderedTriangleOccluded = function (triangle) {

            // returns [longEdge, shortEdge1, shortEdge2], or false on invisible triangle.
            var edgeIndices = this._createEdgesForTriangle(triangle);

            var longEdge = this._edges[edgeIndices[0]];
            var s1 = edgeIndices[1];
            var s2 = edgeIndices[2];

            // Vertical culling
            if (this._verticalLongEdgeCull(longEdge)) {
                // Triangle is outside the view, skipping rendering it;
                return true;
            }

            for (var i = 0; i < 3; i++) {
                // TODO : Move all rounding of values to the scanline loop to be performed per line.
                this._edges[i].roundOccludeeCoordinates();
                // TODO : Move the inversion of z.... to the best place. Has to be done before the creation of the edge data.
                this._edges[i].invertZ();
            }

            var shortEdge = this._edges[s1];
            var edgeData = this._edgePreRenderProcess(longEdge, shortEdge);

            // Find out the orientation of the triangle.
            // That is, if the long edge is on the right or the left side.
            var orientationData = null;
            if (edgeData) {
                orientationData = this._calculateOrientationData(edgeData, shortEdge, longEdge);

                // Horizontal culling
                if (this._horizontalLongEdgeCull(longEdge, orientationData)) {
                    return true;
                }

                // Draw first portion of the triangle
                if(!this._isEdgeOccluded(edgeData, orientationData)){
                    return false;
                }
            }
            shortEdge = this._edges[s2];
            edgeData = this._edgePreRenderProcess(longEdge, shortEdge);
            if (edgeData) {
                // If the orientation hasn't been created, do so.
                if (orientationData === null) {
                    orientationData = this._calculateOrientationData(edgeData, shortEdge, longEdge);
                    // Horizontal culling
                    if (this._horizontalLongEdgeCull(longEdge, orientationData)) {
                        return true;
                    }
                }
                // Draw second portion of the triangle.
                if(!this._isEdgeOccluded(edgeData, orientationData)){
                    return false;
                }
            }

            return true;
        };

        /**
        *	Takes a triangle with coordinates in pixel space, and draws it.
        *	@param {Triangle} triangle the triangle to draw.
        */
        SoftwareRenderer.prototype._renderTriangle = function (triangle) {

            // Original idea of triangle rasterization is taken from here : http://joshbeam.com/articles/triangle_rasterization/
            // The method is improved by using vertical coherence for each of the scanlines.

            var edgeIndices = this._createEdgesForTriangle(triangle);

            var longEdge = this._edges[edgeIndices[0]];
            var s1 = edgeIndices[1];
            var s2 = edgeIndices[2];

            // Vertical culling
            if (this._verticalLongEdgeCull(longEdge)) {
                // Triangle is outside the view, skipping rendering it;
                return;
            }

            for (var i = 0; i < 3; i++) {
                // TODO : Move all rounding of values to the scanline loop to be performed per line.
                this._edges[i].roundOccluderCoordinates();
                // TODO : Move the inversion of z.... to the best place. Has to be done before the creation of the edge data.
                this._edges[i].invertZ();
            }

            var shortEdge = this._edges[s1];
            /*
            TODO : The long edge's data is calculated twice at the momnent. The only difference is if the values are to be
            interpolated to the proper y.
             */
            var edgeData = this._edgePreRenderProcess(longEdge, shortEdge);

            // Find out the orientation of the triangle.
            // That is, if the long edge is on the right or the left side.
            var orientationData = null;
            if (edgeData) {
                orientationData = this._calculateOrientationData(edgeData, shortEdge, longEdge);

                // Horizontal culling
                if (this._horizontalLongEdgeCull(longEdge, orientationData)) {
                    return;
                }

                // Draw first portion of the triangle
                this._drawEdges(edgeData, orientationData);
            }

            shortEdge = this._edges[s2];
            edgeData = this._edgePreRenderProcess(longEdge, shortEdge);
            if (edgeData) {
                // If the orientation hasn't been created, do so.
                if (orientationData === null) {
                    orientationData = this._calculateOrientationData(edgeData, shortEdge, longEdge);
                    // Horizontal culling
                    if (this._horizontalLongEdgeCull(longEdge, orientationData)) {
                        return;
                    }
                }
                // Draw second portion of the triangle.
                this._drawEdges(edgeData, orientationData);
            }
        };

        /**
        *	Returns true if the triangle should be culled, if not, it returns false.
        */
        SoftwareRenderer.prototype._verticalLongEdgeCull = function (longEdge) {
            return longEdge.y1 < 0 || longEdge.y0 > this._clipY;
        };

        /**
        *	Returns true if the triangle should be culled, if not, it returns false.
        * @param orientationData
        * @param longEdge
        */
        SoftwareRenderer.prototype._horizontalLongEdgeCull = function (longEdge, orientationData) {
            if (orientationData[0]) {// long edge on right side
                return longEdge.x1 < 0 && longEdge.x0 < 0;
            } else {
                return longEdge.x1 > this._clipX && longEdge.x0 > this._clipX;
            }
        };

        SoftwareRenderer.prototype._isEdgeOccluded = function(edgeData, orientationData) {

            // Copypasted from _drawEdges.
            var startLine = edgeData.getStartLine();
            var stopLine = edgeData.getStopLine();

            // Checking if the triangle's long edge is on the right or the left side.
            if (orientationData[0]) { //RIGHT ORIENTED (long edge on right side)
                if (orientationData[1]) { //INWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getShortX();
                        var realRightX = edgeData.getLongX();
                        // Conservative rounding (will cause overdraw on connecting triangles)
                        var leftX = Math.floor(realLeftX);
                        var rightX = Math.ceil(realRightX);

                        var leftZ = edgeData.getShortZ();
                        var rightZ = edgeData.getLongZ();

                        // Extrapolate the new depth for the new conservative x-coordinates.
                        // this is needed to not create a non-conservative depth over the new larger span.
                        // TODO : Would be good to get the if case removed. This is needed at the moment because
                        // division by zero occurs in the creation of the slope variable.
                        var dif = rightX - leftX;
                        if (dif > 1) {
                            var slope = (rightZ - leftZ) / (realRightX - realLeftX);
                            rightZ = leftZ + (rightX - realLeftX) * slope;
                            leftZ = leftZ + (leftX - realLeftX) * slope;
                            // The z value being interpolated after this can become negative from the extrapolation.
                            // Using math.max to set the value to zero if it is negative.
                            rightZ = Math.max(0.0, rightZ);
                            leftZ = Math.max(0.0, leftZ);
                        }

                        // To find the minimum depth of an occludee , the left edge of the rightmost pixel is the min depth.
                        // The leftZ is the absolute min depthx
                        var t = 0.5 / (dif + 1); // Using the larger span.
                        rightZ = (1.0 - t) * rightZ + t * leftZ;


                        if (!this._isScanlineOccluded(leftX, rightX, y, leftZ, rightZ)) {
                            return false;
                        }

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                } else { // OUTWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getShortX();
                        var realRightX = edgeData.getLongX();
                        // Conservative rounding (will cause overdraw on connecting triangles)
                        var leftX = Math.floor(realLeftX);
                        var rightX = Math.ceil(realRightX);

                        var leftZ = edgeData.getShortZ();
                        var rightZ = edgeData.getLongZ();

                        // Extrapolate the new depth for the new conservative x-coordinates.
                        // this is needed to not create a non-conservative depth over the new larger span.
                        // TODO : Would be good to get the if case removed. This is needed at the moment because
                        // division by zero occurs in the creation of the slope variable.
                        var dif = rightX - leftX;
                        if (dif > 1) {
                            var slope = (rightZ - leftZ) / (realRightX - realLeftX);
                            rightZ = leftZ + (rightX - realLeftX) * slope;
                            leftZ = leftZ + (leftX - realLeftX) * slope;
                            leftZ = Math.max(0.0, leftZ);
                            rightZ = Math.max(0.0, rightZ);
                        }

                        var t = 0.5 / (dif + 1); // Using the larger span.
                        leftZ = (1.0 - t) * leftZ + t * rightZ;

                        if (!this._isScanlineOccluded(leftX, rightX, y, leftZ, rightZ)) {
                            return false;
                        }

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                }
            } else { // LEFT ORIENTED
                if (orientationData[1]) { //INWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getLongX();
                        var realRightX = edgeData.getShortX();
                        // Conservative rounding (will cause overdraw on connecting triangles)
                        var leftX = Math.floor(realLeftX);
                        var rightX = Math.ceil(realRightX);

                        var leftZ = edgeData.getLongZ();
                        var rightZ = edgeData.getShortZ();

                        // Extrapolate the new depth for the new conservative x-coordinates.
                        // this is needed to not create a non-conservative depth over the new larger span.
                        // TODO : Would be good to get the if case removed. This is needed at the moment because
                        // division by zero occurs in the creation of the slope variable.
                        var dif = rightX - leftX;
                        if (dif > 1) {
                            var slope = (rightZ - leftZ) / (realRightX - realLeftX);
                            rightZ = leftZ + (rightX - realLeftX) * slope;
                            leftZ = leftZ + (leftX - realLeftX) * slope;
                            rightZ = Math.max(0.0, rightZ);
                            leftZ = Math.max(0.0, leftZ);
                        }

                        // To find the minimum depth of an occludee , the left edge of the rightmost pixel is the min depth.
                        // The leftZ is the absolute min depth
                        var t = 0.5 / (dif + 1); // Using the larger span.
                        rightZ = (1.0 - t) * rightZ + t * leftZ;

                        if (!this._isScanlineOccluded(leftX, rightX, y, leftZ, rightZ)) {
                            return false;
                        }

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                } else { // OUTWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getLongX();
                        var realRightX = edgeData.getShortX();
                        // Conservative rounding (will cause overdraw on connecting triangles)
                        var leftX = Math.floor(realLeftX);
                        var rightX = Math.ceil(realRightX);

                        var leftZ = edgeData.getLongZ();
                        var rightZ = edgeData.getShortZ();

                        // Extrapolate the new depth for the new conservative x-coordinates.
                        // this is needed to not create a non-conservative depth over the new larger span.
                        // TODO : Would be good to get the if case removed. This is needed at the moment because
                        // division by zero occurs in the creation of the slope variable.
                        var dif = rightX - leftX;
                        if (dif > 1) {
                            var slope = (rightZ - leftZ) / (realRightX - realLeftX);
                            rightZ = leftZ + (rightX - realLeftX) * slope;
                            leftZ = leftZ + (leftX - realLeftX) * slope;
                            rightZ = Math.max(0.0, rightZ);
                            leftZ = Math.max(0.0, leftZ);
                        }

                        // To find the minimum depth of an occludee , the left edge of the rightmost pixel is the min depth.
                        // The leftZ is the absolute min depth
                        var t = 0.5 / (dif + 1); // Using the larger span.
                        leftZ = (1.0 - t) * leftZ + t * rightZ;

                        if (!this._isScanlineOccluded(leftX, rightX, y, leftZ, rightZ)) {
                            return false;
                        }

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                }
            }

            return true;
        };

        /**
         * Render the pixels between the long and the short edge of the triangle.
         * @param {EdgeData} edgeData
         * @param orientationData
         * @private
         */
        SoftwareRenderer.prototype._drawEdges = function (edgeData, orientationData) {

            // The start and stop lines are already rounded y-coordinates.
            var startLine = edgeData.getStartLine();
            var stopLine = edgeData.getStopLine();

            // Leaning inwards means that the triangle is going inwards from left to right.

            // Compensate for fractional offset + conservative depth.
            // When drawing occluders , as is beeing done here.
            // the minimum value that the pixel can have is the one which should be rendered.
            // this minimum value ís on the left or the right side of the pixel, depending on which
            // way the triangle is leaning.

            // In the case of leaning inwards, the leftmost pixel has the max depth on it's right edge.
            // for the rightmost pixel, it is consequently on it's left side.

            // For for the outwards triangle case, the calculations on the leftmost pixel are made for the right and vice versa.

            // when rendering the occluders, the maxim

            // Checking if the triangle's long edge is on the right or the left side.
            if (orientationData[0]) { // LONG EDGE ON THE RIGHT SIDE
                if (orientationData[1]) { // INWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getShortX();
                        var realRightX = edgeData.getLongX();

                        var leftZ = edgeData.getShortZ();
                        var rightZ = edgeData.getLongZ();
                        // Conservative rounding , when drawing occluders, make area smaller.
                        var leftX = Math.ceil(realLeftX);
                        var rightX = Math.floor(realRightX);

                        // Compensate for the fractional offset on the leftmost pixel.
                        // Regarding the rightZ to be the actual maximum depth.
                        var offset = leftX - realLeftX;
                        var spanLength = realRightX - realLeftX;
                        var t = offset / spanLength;
                        // Linearly interpolate new leftZ
                        leftZ = (1.0 - t) * leftZ + t * rightZ;

                        // Conservative depth, max depth on the edge of the pixel.
                        // Add 0.5 to go to the edge of the pixel.
                        spanLength = (rightX - leftX + 1);
                        var t = (0.5) / spanLength;
                        // Linearly interpolate new leftZ
                        leftZ = (1.0 - t) * leftZ + t * rightZ;

                        // Draw the span of pixels.
                        this._fillPixels(leftX, rightX, y, leftZ, rightZ);

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                } else { // OUTWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getShortX();
                        var realRightX = edgeData.getLongX();

                        var leftZ = edgeData.getShortZ();
                        var rightZ = edgeData.getLongZ();
                        // Conservative rounding , when drawing occluders, make area smaller.
                        var leftX = Math.ceil(realLeftX);
                        var rightX = Math.floor(realRightX);

                        // Compensate fractional offset.
                        var offset = realRightX - rightX;
                        var spanLength = realRightX - realLeftX;
                        var t = offset / spanLength;
                        rightZ = (1.0 - t) * rightZ + t * leftZ;

                        // Add 0.5 to go to the edge of the pixel.
                        spanLength = rightX - leftX + 1;
                        var t = 0.5 / spanLength;
                        rightZ = (1.0 - t) * rightZ + t * leftZ;

                        // Draw the span of pixels.
                        this._fillPixels(leftX, rightX, y, leftZ, rightZ);

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                }
            } else { // LONG EDGE IS ON THE LEFT SIDE
                if (orientationData[1]) { // INWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getLongX();
                        var realRightX = edgeData.getShortX();

                        var leftZ = edgeData.getLongZ();
                        var rightZ = edgeData.getShortZ();

                        // Conservative rounding , when drawing occluders, make area smaller.
                        var leftX = Math.ceil(realLeftX);
                        var rightX = Math.floor(realRightX);

                        // Compensate for the fractional offset on the leftmost pixel.
                        // Regarding the rightZ to be the actual maximum depth.
                        var offset = leftX - realLeftX;
                        var spanLength = realRightX - realLeftX;
                        var t = offset / spanLength;
                        // Linearly interpolate new leftZ
                        leftZ = (1.0 - t) * leftZ + t * rightZ;

                        // Conservative depth, max depth on the edge of the pixel.
                        // Add 0.5 to go to the edge of the pixel.
                        spanLength = (rightX - leftX + 1);
                        var t = (0.5) / spanLength;
                        // Linearly interpolate new leftZ
                        leftZ = (1.0 - t) * leftZ + t * rightZ;

                        // Draw the span of pixels.
                        this._fillPixels(leftX, rightX, y, leftZ, rightZ);

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                } else { // OUTWARDS TRIANGLE
                    for (var y = startLine; y <= stopLine; y++) {

                        var realLeftX = edgeData.getLongX();
                        var realRightX = edgeData.getShortX();

                        var leftZ = edgeData.getLongZ();
                        var rightZ = edgeData.getShortZ();

                        // Conservative rounding , when drawing occluders, make area smaller.
                        var leftX = Math.ceil(realLeftX);
                        var rightX = Math.floor(realRightX);

                        // Compensate fractional offset.
                        var offset = realRightX - rightX;
                        var spanLength = realRightX - realLeftX;
                        var t = offset / spanLength;
                        rightZ = (1.0 - t) * rightZ + t * leftZ;

                        // Add 0.5 to go to the edge of the pixel.
                        spanLength = rightX - leftX + 1;
                        var t = 0.5 / spanLength;
                        rightZ = (1.0 - t) * rightZ + t * leftZ;

                        // Draw the span of pixels.
                        this._fillPixels(leftX, rightX, y, leftZ, rightZ);

                        this._updateEdgeDataToNextLine(edgeData);
                    }
                }
            }
        };

        /**
        * // TODO : Look up if it would be faster to store the increments as local variables in the
        *			scanline rendering loop. This to not have to access the array if that would cause
        *			unneccessary reads and maybe cashe misses?
        */
        SoftwareRenderer.prototype._updateEdgeDataToNextLine = function (edgeData) {
            edgeData.updateXValues();
        };

        /**
         * Creates the EdgeData , used for rendering.
        *	@return {EdgeData} edgeData
        */
        SoftwareRenderer.prototype._edgePreRenderProcess = function (longEdge, shortEdge) {

            // TODO: Move a lot of these calculations and variables into the Edge class,
            // do the calculations once for the long edge instead of twices as it is done now.

            // Early exit when the short edge doesnt have any height (y-axis).
            // -The edges' coordinates are stored as uint8, so compare with a SMI (SMall Integer, 31-bit signed integer) and not Double.

            var shortEdgeDeltaY = (shortEdge.y1 - shortEdge.y0);
            if(shortEdgeDeltaY <= 0) {
                return; // Nothing to draw here.
            }

            var longEdgeDeltaY = (longEdge.y1 - longEdge.y0);

            // Checking the long edge will probably be unneccessary, since if the short edge has no height, then the long edge most defenetly hasnt either?
            // Shouldn't be possible for the long edge to be of height 0 if any of the short edges has height.

            var longEdgeDeltaX = longEdge.x1 - longEdge.x0;
            var shortEdgeDeltaX = shortEdge.x1 - shortEdge.x0;

            var longStartZ = longEdge.z0;
            var shortStartZ = shortEdge.z0;
            var longEdgeDeltaZ = longEdge.z1 - longStartZ;
            var shortEdgeDeltaZ = shortEdge.z1 - shortStartZ;

            // Vertical coherence :
            // The x-coordinates' increment for each step in y is constant,
            // so the increments are pre-calculated and added to the coordinates
            // each scanline.

            // The scanline on which we start rendering on might be in the middle of the long edge,
            // the starting x-coordinate is therefore calculated.
            var longStartCoeff = (shortEdge.y0 - longEdge.y0) / longEdgeDeltaY;
            var longX = longEdge.x0 + longEdgeDeltaX * longStartCoeff;
            var longZ = longStartZ + longEdgeDeltaZ * longStartCoeff;
            var longEdgeXincrement = longEdgeDeltaX / longEdgeDeltaY;
            var longEdgeZincrement = longEdgeDeltaZ / longEdgeDeltaY;


            var shortX = shortEdge.x0;
            var shortZ = shortStartZ;
            var shortEdgeXincrement = shortEdgeDeltaX / shortEdgeDeltaY;
            var shortEdgeZincrement = shortEdgeDeltaZ / shortEdgeDeltaY;

            var startLine = shortEdge.y0;
            var stopLine = shortEdge.y1;

            // Vertical clipping
            // TODO : Implement a cohen sutherland image space clipper for the horizontal and vertical clipping.
            if (startLine < 0) {
                // If the starting line is above the screen space,
                // the starting x-coordinates has to be advanced to
                // the proper value.
                // And the starting line is then assigned to 0.
                longX += -startLine * longEdgeXincrement;
                shortX += -startLine * shortEdgeXincrement;
                longZ += -startLine * longEdgeZincrement;
                shortZ += -startLine * shortEdgeZincrement;
                startLine = 0;
            }

            if (stopLine > this._clipY ) {
                stopLine = this._clipY;
            }

            return new EdgeData([startLine, stopLine, longX, shortX, longZ, shortZ, longEdgeXincrement, shortEdgeXincrement, longEdgeZincrement, shortEdgeZincrement]);
        };

        /**
         * Returns true if the scanline of rasterized pixels are occluded. Early exits on visible pixels and returns false.
         * @param leftX
         * @param rightX
         * @param y
         * @param leftZ
         * @param rightZ
         * @returns {boolean}
         * @private
         */
        SoftwareRenderer.prototype._isScanlineOccluded = function (leftX, rightX, y, leftZ, rightZ) {

            // 99% COPY PASTE FROM _fillPixels()!

            if (rightX < 0 || leftX > this._clipX || rightX < leftX) {
                return true; // Nothing to draw here. it is occluded
            }

            if (leftZ < 0 || leftZ > 1.0000001) {
                console.error("leftZ : ", leftZ);
            }

            if (rightZ < 0 || rightZ > 1.0000001) {
                console.error("rightZ : ", rightZ);
            }

            // Horizontal clipping
            var t;
            // If the triangle's scanline is clipped, the bounding z-values have to be interpolated
            // to the new startpoints.
            if (leftX < 0) {
                t = -leftX / (rightX - leftX + 1);
                leftZ = (1.0 - t) * leftZ + t * rightZ;
                leftX = 0;
            }

            var diff = rightX - this._clipX + 1;
            if (diff > 0) {
                t = diff / (rightX - leftX + 1);
                rightZ = (1.0 - t) * rightZ + t * leftZ;
                rightX = this._clipX;
            }

            var index = y * this.width + leftX;
            var depth = leftZ;
            var depthIncrement = (rightZ - leftZ) / (rightX - leftX);
            // Fill all pixels in the interval [leftX, rightX].
            for (var i = leftX; i <= rightX; i++) {

                // TODO : Remove this debugg add of color in prod....
                this._colorData.set([Math.min(depth * 255 + 50, 255), 0, 0], index * 4);

                // Check if the value is closer than the stored one. z-test.
                if (depth > this._depthData[index]) {
                    // Not occluded
                    return false;
                }

                index++;
                depth += depthIncrement;
            }
            // Occluded
            return true;
        };

        /**
        *	Writes the span of pixels to the depthData. The pixels written are
        *	the closed interval of [leftX, rightX] on the y-coordinte y.
        *
        */
        SoftwareRenderer.prototype._fillPixels = function (leftX, rightX, y, leftZ, rightZ) {

            if (rightX < 0 || leftX > this._clipX || rightX < leftX) {
                return false; // Nothing to draw here.
            }

            if (leftZ < 0 || leftZ > 1.0000001) {
                console.error("leftz : ", leftZ);
            }

            if (rightZ < 0 || rightZ > 1.0000001) {
                console.error("rightZ : ", rightZ);
            }

            // Horizontal clipping
            // TODO : Implement a clippping method to clip hoorizontally earlier in the pipeline.
            var t;
            // If the triangle's scanline is clipped, the bounding z-values have to be interpolated
            // to the new startpoints.
            if (leftX < 0) {
                t = -leftX / (rightX - leftX + 1);
                leftZ = (1.0 - t) * leftZ + t * rightZ;
                leftX = 0;
            }

            // TODO : Revise the span of pixels here... if the +1 is needed for the correct width..
            // as it is a closed interval from left to right it is probably needed. Maybe do the addition to the parameter before
            // and then render the open interval [leftx, rightx[.
            // But then the depthIncrement would have to use a - 1 in that interval.
            var diff = rightX - this._clipX + 1;
            if (diff > 0) {
                t = diff / (rightX - leftX + 1);
                rightZ = (1.0 - t) * rightZ + t * leftZ;
                rightX = this._clipX;
            }

            var index = y * this.width + leftX;
            // Starting depth is leftZ , the depth is then incremented for each pixel.
            // The last depth to be drawn should be equal to rightZ.
            var depth = leftZ;
            var depthIncrement = (rightZ - leftZ) / (rightX - leftX);
            // Fill all pixels in the interval [leftX, rightX].
            for (var i = leftX; i <= rightX; i++) {

                // Check if the value is closer than the stored one. z-test.
                if (depth > this._depthData[index]) {
                    this._depthData[index] = depth;  // Store 1/w values in range [1/far, 1/near].
                }

                index++;
                depth += depthIncrement;
            }

            /*
            var lastDepth = depth - depthIncrement;
            if ( Math.abs(lastDepth - rightZ) >= 0.0000000001 && rightX - leftX >= 0) {
                console.error("Wrong depth interpolation!");
                console.log("lastdepth", lastDepth);
                console.log("rightZ", rightZ);
                console.log("depthIncrement", depthIncrement);
            }
            */
        };

        /**
        *	Maps the data in the depth buffer to gray scale values in the color buffer.
        */
        SoftwareRenderer.prototype.copyDepthToColor = function () {

            var colorIndex = 0;

            for(var i = 0; i < this._depthData.length; i++) {

                // Convert the float value of depth into 8bit.
                var depth = this._depthData[i] * 255;
                this._colorData[colorIndex] = depth;
                this._colorData[++colorIndex] = depth;
                this._colorData[++colorIndex] = depth;
                this._colorData[++colorIndex] = 255;
                colorIndex++;
            }
        };


        /**
        *	Returns the array of RGBA color data.
        *	@return {Uint8Array} RGBA Color data.
        */
        SoftwareRenderer.prototype.getColorData = function () {
            return this._colorData;
        };

        /**
        *	Returns the array of depth data.
        *	@return {Float32Array} Depth data.
        */
        SoftwareRenderer.prototype.getDepthData = function () {

            return this._depthData;
        };


        SoftwareRenderer.prototype.calculateDifference = function (webGLColorData, clearColor) {
            for (var i = 0; i < this._depthData.length; i++) {
                var depthvalue = this._depthData[i];

                var colorIndex = 4 * i;
                var R = webGLColorData[colorIndex];
                var G = webGLColorData[colorIndex + 1];
                var B = webGLColorData[colorIndex + 2];
                var A = webGLColorData[colorIndex + 3];
                // Make a red pixel if there is depth where there is no color in any channel except for the clear color value for that channel. (There is difference at this location)
                if (depthvalue > 0.0 && !(R > clearColor[0] * 256 || G > clearColor[1] * 256 || B > clearColor[2] * 256 || A > clearColor[3] * 256)) {
                    this._colorData[colorIndex] = 255;
                    this._colorData[colorIndex + 1] = 0;
                    this._colorData[colorIndex + 2] = 0;
                    this._colorData[colorIndex + 3] = 255;
                }
            }
        };

        return SoftwareRenderer;
});