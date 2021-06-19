/**
 *	BVHLoader for VRM
 *	Mod: [lo'ner]
 *	Description:
 *		Modified from THREE.js BVHLoader sample
 *		Changed to Class
 *		Retargeting of BVH files to a base skeleton
 *		Implements Axes correction for VRM (Y:up, -Z:fw)
 *		All preprocessing for BVH performed during import, hence speeding up
 *			actual load during runtime
 */

import {
	AnimationClip,
	Bone,
	FileLoader,
	Loader,
	Quaternion,
	QuaternionKeyframeTrack,
	Skeleton,
	Vector3,
	VectorKeyframeTrack,
	Euler
} from '/build/three.module.js';

/**
 * Description: reads BVH files and outputs a single Skeleton and an AnimationClip
 * Currently only supports bvh files containing a single root.
 *
 */
class BVHLoader extends Loader {
	constructor () {
		super();
		this.animateBonePositions = true;
		this.animateBoneRotations = true;

		this.boneMap = new Map();
		this.mapList = undefined;
		this.mapActive = undefined;
	}

	async init () {
		await this.getList();
		for (let map of this.mapList.maps) {
			await this.getMap(map.name, map.url);
		}		
		//console.log (this.boneMap);
	}
	async getList () {
		await fetch('/scripts/lib/srcMaps/srcMaps.json')
			.then(res => res.json())
			.then(data => this.mapList = data );
	}
	async getMap (id, url) {
        await fetch(url)
            .then(res => res.json())
            .then(data => this.boneMap.set(id, data) );
	}

	load (url, onLoad, onProgress, onError) {
        fetch( url )
            .then( response => response.text())
            .then( data => onLoad(this.parse(data)) );
	}
	/*
		reads a string array (lines) from a BVH file
		and outputs a skeleton structure including motion data

		returns thee root node:
		{ name: '', channels: [], children: [] }
	*/
	readBvh( lines ) {
		// read model structure
		if ( this.nextLine( lines ) !== 'HIERARCHY' ) {
			console.error( 'THREE.BVHLoader: HIERARCHY expected.' );
		}
		let list = []; // collects flat array of all bones
		let root = this.readNode( lines, this.nextLine( lines ), list );

		// read motion data
		if ( this.nextLine( lines ) !== 'MOTION' ) {
			console.error( 'THREE.BVHLoader: MOTION expected.' );
		}

		// number of frames
		let tokens = this.nextLine( lines ).split( /[\s]+/ );
		let numFrames = parseInt( tokens[ 1 ] );
		if ( isNaN( numFrames ) ) {
			console.error( 'THREE.BVHLoader: Failed to read number of frames.' );
		}

		// frame time
		tokens = this.nextLine( lines ).split( /[\s]+/ );
		let frameTime = parseFloat( tokens[ 2 ] );
		if ( isNaN( frameTime ) ) {
			console.error( 'THREE.BVHLoader: Failed to read frame time.' );
		}

		// read frame data line by line
		for ( let i = 0; i < numFrames; i ++ ) {
			tokens = this.nextLine( lines ).split( /[\s]+/ );
			this.readFrameData( tokens, i * frameTime, root );
		}

		return list;
	}
	/*
		Recursively reads data from a single frame into the bone hierarchy.
		The passed bone hierarchy has to be structured in the same order as the BVH file.
		keyframe data is stored in bone.frames.

		- data: splitted string array (frame values), values are shift()ed so
		this should be empty after parsing the whole hierarchy.
		- frameTime: playback time for this keyframe.
		- bone: the bone to read frame data from.
	*/
	readFrameData( data, frameTime, bone ) {
		// end sites have no motion data
		if ( bone.type === 'ENDSITE' ) return;

		// add keyframe
		let keyframe = {
			time: frameTime,
			position: new Vector3(),
			rotation: new Quaternion()
		};

		bone.frames.push( keyframe );
		
		let quat = new Quaternion();
		let vx = new Vector3( 1, 0, 0 );
		let vy = new Vector3( 0, 1, 0 );
		let vz = new Vector3( 0, 0, 1 );

		// parse values for each channel in node
		for ( let channel of bone.channels ) {
			switch ( channel ) {
				case 'Xposition':
					keyframe.position.x = parseFloat( data.shift().trim() );
					break;
				case 'Yposition':
					keyframe.position.y = parseFloat( data.shift().trim() );
					break;
				case 'Zposition':
					keyframe.position.z = parseFloat( data.shift().trim() );
					break;
				case 'Xrotation':
					quat.setFromAxisAngle( vx, parseFloat( data.shift().trim() ) * Math.PI / 180 );
					keyframe.rotation.multiply( quat );
					break;
				case 'Yrotation':
					quat.setFromAxisAngle( vy, parseFloat( data.shift().trim() ) * Math.PI / 180 );
					keyframe.rotation.multiply( quat );
					break;
				case 'Zrotation':
					quat.setFromAxisAngle( vz, parseFloat( data.shift().trim() ) * Math.PI / 180 );
					keyframe.rotation.multiply( quat );
					break;
				default:
					console.warn( 'THREE.BVHLoader: Invalid channel type.' );
			}
		}
		keyframe.position = this.adjustXYZ(keyframe.position);
		keyframe.rotation = this.adjustQ(keyframe.rotation);
		
		// parse child nodes
		for ( let child of bone.children ) {
			this.readFrameData( data, frameTime, child );
		}
	}
	/*
		Recursively parses the HIERACHY section of the BVH file
		- lines: all lines of the file. lines are consumed as we go along.
		- firstline: line containing the node type and name e.g. 'JOINT hip'
		- list: collects a flat list of nodes

		returns: a BVH node including children
	*/
	readNode( lines, firstline, list ) {
		let node = { name: '', type: '', frames: [] };
		list.push( node );

		// parse node type and name
		let tokens = firstline.split( /[\s]+/ );
		if ( tokens[ 0 ].toUpperCase() === 'END' && tokens[ 1 ].toUpperCase() === 'SITE' ) {
			node.type = 'ENDSITE';
			node.name = 'ENDSITE'; // bvh end sites have no name
		} 
		else {
			node.name = (this.mapActive && this.mapActive.bones[tokens[ 1 ]])  ? this.mapActive.bones[tokens[ 1 ]] : tokens[ 1 ];
			node.type = tokens[ 0 ].toUpperCase();
		}
		if ( this.nextLine( lines ) !== '{' ) {
			console.error( 'THREE.BVHLoader: Expected opening { after type & name' );
		}

		// parse OFFSET
		tokens = this.nextLine( lines ).split( /[\s]+/ );
		if ( tokens[ 0 ] !== 'OFFSET' ) {
			console.error( 'THREE.BVHLoader: Expected OFFSET but got: ' + tokens[ 0 ] );
		}

		if ( tokens.length !== 4 ) {
			console.error( 'THREE.BVHLoader: Invalid number of values for OFFSET.' );
		}

		let offset = new Vector3(
			parseFloat( tokens[ 1 ] ),
			parseFloat( tokens[ 2 ] ),
			parseFloat( tokens[ 3 ] )
		);

		if ( isNaN( offset.x ) || isNaN( offset.y ) || isNaN( offset.z ) ) {
			console.error( 'THREE.BVHLoader: Invalid values of OFFSET.' );
		}
		node.offset = this.adjustXYZ(offset);

		// parse CHANNELS definitions
		if ( node.type !== 'ENDSITE' ) {
			tokens = this.nextLine( lines ).split( /[\s]+/ );
			if ( tokens[ 0 ] !== 'CHANNELS' ) {
				console.error( 'THREE.BVHLoader: Expected CHANNELS definition.' );
			}
			let numChannels = parseInt( tokens[ 1 ] );
			node.channels = tokens.splice( 2, numChannels );
			node.children = [];
		}

		// read children
		while ( true ) {
			let line = this.nextLine( lines );
			if ( line === '}' ) {
				return node;
			} else {
				node.children.push( this.readNode( lines, line, list ) );
			}
		}
	}
	/*
		recursively converts the internal bvh node structure to a Bone hierarchy

		source: the bvh root node
		list: pass an empty array, collects a flat list of all converted THREE.Bones

		returns the root Bone
	*/
	toTHREEBone( source, list ) {
		let bone = new Bone();
		list.push( bone );

		bone.position.add( source.offset );
		bone.name = source.name;
		if ( source.type !== 'ENDSITE' ) {
			for (let child of source.children) {
				bone.add( this.toTHREEBone( child, list ));
			}
		}
		return bone;
	}
	/*
		builds a AnimationClip from the keyframe data saved in each bone.
		bone: bvh root node
		returns: a AnimationClip containing position and quaternion tracks
	*/
	toTHREEAnimation( bones ) {
		let tracks = [];

		// create a position and quaternion animation track for each node
		for ( let bone of bones) {
			if ( bone.type === 'ENDSITE' ) continue;
			// track data
			let times = [];
			let positions = [];
			let rotations = [];
			for ( let frame of bone.frames) {
				times.push( frame.time );
				// the animation system animates the position property,
				// so we have to add the joint offset to all values
				// TODO: remove offset
				positions.push( frame.position.x );// + bone.offset.x );
				positions.push( frame.position.y );// + bone.offset.y );
				positions.push( frame.position.z );// + bone.offset.z );
				rotations.push( frame.rotation.x );
				rotations.push( frame.rotation.y );
				rotations.push( frame.rotation.z );
				rotations.push( frame.rotation.w );
			}
			if ( this.animateBonePositions ) {
				// tracks.push( new VectorKeyframeTrack( '.bones[' + bone.name + '].position', times, positions ) );
				tracks.push( new VectorKeyframeTrack( '.' + bone.name + '.position', times, positions ).optimize() );
			}
			if ( this.animateBoneRotations ) {
				// tracks.push( new QuaternionKeyframeTrack( '.bones[' + bone.name + '].quaternion', times, rotations ) );
				tracks.push( new QuaternionKeyframeTrack( '.' + bone.name + '.quaternion', times, rotations ).optimize() );
			}
		}
		return new AnimationClip( 'animation', - 1, tracks );
	}
	/*
		returns the next non-empty line in lines
	*/
	nextLine( lines ) {
		let line;
		// skip empty lines
		while ( ( line = lines.shift().trim() ).length === 0 ) { }
		return line;
	}

	detectMap ( txt ) {
		let lines = txt.split( /[\r\n]+/g );
		let tmpLine = this.nextLine( lines );	// "HIERARCHY"		
		let rootLine = this.nextLine( lines );
		let tokens = rootLine.split( /[\s]+/ );
		//console.log(this.boneMap);

		this.mapActive = null;
		for (let [k,v] of this.boneMap.entries()) {
			if ( tokens[0].toUpperCase() === 'ROOT') {
				if ( this.boneMap.get(k).bones[tokens[1]] === "Hips") {
					this.mapActive = this.boneMap.get(k);
					break;
				}
			} 
		}
	}

	async parse ( txt ) {
		// Detect boneMap to use
		this.detectMap( txt );

		let lines = txt.split( /[\r\n]+/g );
		let bones = this.readBvh( lines );
		let threeBones = [];
		this.toTHREEBone( bones[ 0 ], threeBones );
		let threeClip = this.toTHREEAnimation( bones );

		return {
			skeleton: new Skeleton( threeBones ),
			clip: threeClip
		};
	}

	
	/**
	 * Some Quaternion utilities
	 */
	 quaternionToAxisAngle(q) {
		let axis = new Vector3();
		let angle = 2*Math.acos(q.w);
		let s = Math.sqrt(1 - q.w*q.w);
		if (s<0.001) {
			axis.x = q.x;
			axis.y = q.y;
			axis.z = q.z;
		}
		else {
			axis.x = q.x / s;
			axis.y = q.y / s;
			axis.z = q.z / s;
		}
		return [axis, angle];
	}
	adjustXYZ(v) {
		return new Vector3(this.mapActive.adjust[0]*v.x, 
						   this.mapActive.adjust[1]*v.y, 
						   this.mapActive.adjust[2]*v.z);
	}
	adjustQ(q) {
		let aa = this.quaternionToAxisAngle(q);
		return new Quaternion().setFromAxisAngle(this.adjustXYZ(aa[0]), this.mapActive.adjust[3]*aa[1])
	}
	
}

export { BVHLoader };
