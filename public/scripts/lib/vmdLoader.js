/**
 *	VMDLoader for VRM
 *	Mod: [lo'ner]
 *	Description:
 *    Default three.js MMDParser has errors (unknown char code)
 *    VRM_dance_viewer has errors (leg IK)
 *    Based on MMDLoader, vpvp-vmd and vrm_dance_viewer, converted to Class
 *      Uses fetch instead of XMLHTTPRequest, faster but only new browser support
 *		Implements Axes correction for VRM (Y:up, -Z:fw)
 *		IK compute options:
 *          - Compute IK at runtime: taxing to CPU at every runtime, less load time.
 *            This also makes it possible to do interactive animations
 *          - Precompute at load time: One time computation, allows for more running avatars.
 *            However, this requires running the animation once on a donor model to bake the IKs
 *		All preprocessing for VMD performed during import, hence speeding up
 *			actual load during runtime
 *  Limitations:
 *    Limited root/master bone rotation: allow only at frame0 and holds for entire animation
 *    Limited IK enabling/disabling: set at frame0 for entire animation
 */

import {
	AnimationClip,
	Bone,
	FileLoader,
    Interpolant,
    Loader,
    MathUtils,
	Quaternion,
	QuaternionKeyframeTrack,
	Skeleton,
	Vector3,
	VectorKeyframeTrack,
    NumberKeyframeTrack,
	Euler,
    InterpolateSmooth,
    InterpolateDiscrete,
    Matrix4
} from '/build/three.module.js';
import { VRMIkHandler } from './ikHandler.js' 
import { MMDLoader } from '/jsm/loaders/MMDLoader'
import { MMDAnimationHelper } from '/jsm/animation/MMDAnimationHelper.js'

 /**
 * Description: Parses a VMD file
 */
class VMDLoader {
    constructor(scene=null) {
        this.scene = scene;
        this.config = undefined;
        this.md = new MMDLoader();
        this.helper = new MMDAnimationHelper();
        this.handler = new VRMIkHandler(this.scene);
        this.donor = undefined;

        // offsets
        this.centerOffset = new Vector3();
        this.lfootIKParentOffset = new Vector3();
        this.lfootIKOffset = new Vector3();
        this.ltoeIKOffset = new Vector3();
        this.rfootIKParentOffset = new Vector3();
        this.rfootIKOffset = new Vector3();
        this.rtoeIKOffset = new Vector3();
    }
    async init() {
        await this.getMap();
        await this.getDonor();
    }
    async getMap () {
        // read Vocaloid map, since this is VMD
        await fetch("/scripts/lib/srcMaps/vocaloid.json")
            .then(res => res.json())
            .then(data => this.config = data);
    }
    async getDonor () {
        // Donor model is TDA Miku base, bones only without meshes
        await this.md.load("https://cdn.glitch.com/3aab6bc9-e20d-4689-98cc-1b114af7f83a%2FTDA%20donor.pmx?v=1623979853697", (model) => {
            this.donor = model;
            // console.log(model);
        })
    }

    load (url, onLoad, onProgress, onError) {
        fetch( url )
            .then( response => response.arrayBuffer())
            .then( data => onLoad(this.parse(data)) );
    }

    parse (buffer) {
        let reader = new VMDReader(buffer, this.config);

        let header = reader.readHeader();
        let bones = reader.readBone();
        let morphs = reader.readMorph();
        let iks = reader.readIk();
        let camera = reader.readCamera();

        let clip = bones.length>0 ? this.buildClip(bones, iks) : [];
        let morph = morphs.length>0 ? this.buildMorph(morphs) : [];
        let cam = camera.length > 0 ? this.buildCam(camera) : [];
        let ik = iks.length > 0 ? this.buildIK(iks) : [];

        return {
            metadata: header,
            ik: ik,
            clip: clip,
            morph: morph,
            // TODO: for now, ignore the rest
            camera: cam,
            // light: light,
            // shadow: shadow,
            hasAudio: true,      // this is dance motion, needs music
            useExtraRig: true,    // this is PMX model, uses extra bones in animation
            offsets: {
                center: this.centerOffset,
                lfootIKParent: this.lfootIKParentOffset,
                lfootIK: this.lfootIKOffset,
                ltoeIK: this.ltoeIKOffset,
                rfootIKParent: this.rfootIKParentOffset,
                rfootIK: this.rfootIKOffset,
                rtoeIK: this.rtoeIKOffset
            }
          };
    }

    buildClip (bones, iks) {
        let motions = {};
        let tracks = [];
        for (let bone of bones) {
            if (this.config && this.config.bones[bone.name]) {
                motions[this.config.bones[bone.name]] = motions[this.config.bones[bone.name]] || [];
                motions[this.config.bones[bone.name]].push(bone);
            }
        }

        // VRM Extra Rig: VRM center corresponds to PMX hip
        // Assumes donor model is at rest pose
        if (this.donor) {
            const hipBone = this.donor.skeleton.bones.find(b => b.name=="Hips");
            hipBone.getWorldPosition(this.centerOffset);  
        }
        else {
            this.centerOffset.set(0,12.7832,0.5122);       // manually determined offset
        }
        motions["Center"].map(track => {track.position = track.position.add(this.centerOffset)});       

        // TODO: currently, only assumes IK enabled/disabled for entire animation
        let enabled = {};
        if (iks.length > 0) {
            for (let ik of iks[0].iks) {
                if (this.config.bones[ik.name]) enabled[this.config.bones[ik.name]] = ik.enable;
            }
        }
        if (enabled["RightFootIK"] || enabled["RightToeIK"]) {
            // sort the IK motions
            motions["RightFootIKParent"].sort((a,b) => {return a.frame - b.frame});
            motions["RightFootIK"].sort((a,b) => {return a.frame - b.frame});
            motions["RightToeIK"].sort((a,b) => {return a.frame - b.frame});
   
            // console.log(VMDUtils.quaternionToEulerAngles(new Quaternion(0.074, -0.95, -0.29, -0.07)))
            if (this.donor) {
                this.rfootIKParentOffset = this.donor.skeleton.bones.find(b => b.name == "RightFootIKParent").position;
                this.rfootIKOffset = this.donor.skeleton.bones.find(b => b.name == "RightFootIK").position;
                this.rtoeIKOffset = this.donor.skeleton.bones.find(b => b.name == "RightToeIK").position;
            }
            else {
                this.rfootIKParentOffset.set(-1.0130,0,-0.6805);
                this.rfootIKOffset.set(0,0.9534,0);
                this.rtoeIKOffset.set(0,-0.9534,1.7651);
            }
            let rfootIKParentPos = this.localOffset(this.rfootIKParentOffset, motions["RightFootIKParent"], motions["Root"]);
            motions["RightFootIKParent"] = rfootIKParentPos;
            let rfootIKPos = this.localOffset(this.rfootIKOffset, motions["RightFootIK"], motions["RightFootIKParent"]);
            motions["RightFootIK"] = rfootIKPos;
            let rtoeIKPos = this.localOffset(this.rtoeIKOffset, motions["RightToeIK"], motions["RightFootIK"], true)
            motions["RightToeIK"] = rtoeIKPos;
        }
        else {
            delete motions["RightFootIK"];
            delete motions["RightToeIK"];
        }
        if (enabled["LeftFootIK"] || enabled["LeftToeIK"]) {
            // sort the IK motions
            motions["LeftFootIKParent"].sort((a,b) => {return a.frame - b.frame});
            motions["LeftFootIK"].sort((a,b) => {return a.frame - b.frame});
            motions["LeftToeIK"].sort((a,b) => {return a.frame - b.frame});

            if (this.donor) {
                this.lfootIKParentOffset = this.donor.skeleton.bones.find(b => b.name == "LeftFootIKParent").position;
                this.lfootIKOffset = this.donor.skeleton.bones.find(b => b.name == "LeftFootIK").position;
                this.ltoeIKOffset = this.donor.skeleton.bones.find(b => b.name == "LeftToeIK").position;
            }
            else {
                this.lfootIKParentOffset.set(1.0130,0,-0.6805);
                this.lfootIKOffset.set(0,0.9534,0);
                this.ltoeIKOffset.set(0,-0.9534,1.7651);
            }
            let lfootIKParentPos = this.localOffset(this.lfootIKParentOffset, motions["LeftFootIKParent"], motions["Root"]);
            motions["LeftFootIKParent"] = lfootIKParentPos;
            let lfootIKPos = this.localOffset(this.lfootIKOffset, motions["LeftFootIK"], motions["LeftFootIKParent"]);
            motions["LeftFootIK"] = lfootIKPos;
            let ltoeIKPos = this.localOffset(this.ltoeIKOffset, motions["LeftToeIK"], motions["LeftFootIK"], true);
            motions["LeftToeIK"] = ltoeIKPos;
        }
        else {
            delete motions["LeftFootIK"];
            delete motions["LeftToeIK"];
        }
        for (let key in motions) {
            let array = motions[key];
            array.sort((a,b) => {return a.frame - b.frame});

            let times = [];
            let positions = [];
            let rotations = [];
            let pInterpolations = [];
            let rInterpolations = [];

            // Only hip position is needed; however VMD does not contain model information
            //var basePosition = mesh.skeleton.getBoneByName( key ).position.toArray();

            for (let entry of array) {
                times.push(entry.frame/30.0);   // 30fps

                let adjustPos = VMDUtils.adjustXYZ(entry.position);//.applyQuaternion(correctionQ);
                positions.push(...adjustPos.toArray());    //TODO: add basePosition

                let adjustRot = VMDUtils.adjustQ(entry.quaternion, key);
                rotations.push(adjustRot.x);
                rotations.push(adjustRot.y);
                rotations.push(adjustRot.z);
                rotations.push(adjustRot.w);

                pInterpolations.push(entry.bezier);     // currently unused
                rInterpolations.push(entry.bezier.r)    // currently unused
            }

            tracks.push ( new VectorKeyframeTrack( '.' + key + '.position', times, positions, InterpolateSmooth ).optimize());
            // tracks.push ( new QuaternionKeyframeTrack( '.' + key + '.quaternion', times, rotations, InterpolateSmooth ).optimize() );
            // TODO: optimize interpolations
            // tracks.push( this._createTrack( targetName + '.position', VectorKeyframeTrack, times, positions, pInterpolations ) );
            tracks.push( this.createTrack( '.' + key + '.quaternion', QuaternionKeyframeTrack, times, rotations, rInterpolations ) );  
        }
        let animClip = new AnimationClip( 'animation', -1, tracks );
        return animClip;
    }

    buildMorph (morphs) {
        let targets = {};
        let tracks = [];
        for (let morph of morphs) {
            if (this.config && this.config.morphs[morph.name]) {
                targets[this.config.morphs[morph.name]] = targets[this.config.morphs[morph.name]] || [];
                targets[this.config.morphs[morph.name]].push(morph);
            }
            // TODO: debug: display morph not included in list
            // else {
            //     notargets[morph.name] = notargets[morph.name] || [];
            //     notargets[morph.name].push(morph);
            // }
        }
        // console.log (targets);
        for (let key in targets) {
            let array = targets[key];
            array.sort((a,b) => {return a.frame - b.frame});

            let times = [];
            let values = [];

            for (let entry of array) {
                times.push(entry.frame/30.0);   // 30fps
                values.push(entry.weight);
            }

            if (times.length == 1 && values[0] == 0) continue;

            tracks.push ( new NumberKeyframeTrack( '.' + key + '.morph', times, values, InterpolateSmooth ).optimize());
        }
        let animClip = new AnimationClip( 'morphs', -1, tracks );
        return animClip;
    }

    buildCam (camera) {

        function pushInterpolations (array, interpolation) {
            array.push(interpolation.x1/127);
            array.push(interpolation.x2/127);
            array.push(interpolation.y1/127);
            array.push(interpolation.y2/127);
        }

        let tracks = [];
        camera.sort((a,b) => {return a.frame - b.frame});

        let times = [];
        let targets = [];
        let quaternions = [];
        let positions = [];
        let fovs = [];

        let tInterpolations = [];
        let qInterpolations = [];
        let pInterpolations = [];
        let fInterpolations = [];

        let quaternion = new Quaternion();
        let euler = new Euler();
        let position = new Vector3();
        let target = new Vector3();

        for (let entry of camera) {
            times.push(entry.frame/30.0);   // 30fps
            
            position.set(0,0,entry.distance);
            target.set(entry.position.x, entry.position.y, entry.position.z);
            euler.set(-entry.rotation.x, -entry.rotation.y, -entry.rotation.z);
            quaternion.setFromEuler(euler);
            position.applyQuaternion(quaternion);
            position.add(target);           // MOD: moved after applyQuaternion

            targets.push(-target.x);
            targets.push(target.y);
            targets.push(target.z);
            pushInterpolations(tInterpolations, entry.bezier.x);
            pushInterpolations(tInterpolations, entry.bezier.y);
            pushInterpolations(tInterpolations, entry.bezier.z);

            quaternions.push(quaternion.x);
            quaternions.push(quaternion.y);
            quaternions.push(quaternion.z);
            quaternions.push(quaternion.w);
            pushInterpolations(qInterpolations, entry.bezier.r);

            positions.push(-position.x);
            positions.push(position.y);
            positions.push(position.z);
            pushInterpolations(pInterpolations, entry.bezier.l);   //x
            pushInterpolations(pInterpolations, entry.bezier.l);   //y
            pushInterpolations(pInterpolations, entry.bezier.l);   //z

            fovs.push(entry.fov);
            pushInterpolations(fInterpolations, entry.bezier.v);
        }
        tracks.push( new VectorKeyframeTrack ('.target.position', times, targets, InterpolateSmooth).optimize() );
        //tracks.push( new QuaternionKeyframeTrack( '.camera.quaternion', times, quaternions, InterpolateSmooth ).optimize() );
        tracks.push( new VectorKeyframeTrack( '.camera.position', times, positions, InterpolateSmooth ).optimize() );
        tracks.push( new NumberKeyframeTrack( '.camera.fov', times, fovs, InterpolateDiscrete ).optimize() );
        // tracks.push( this.createTrack('.target.position', VectorKeyframeTrack, times, targets, tInterpolations));
        tracks.push( this.createTrack('.camera.quaternion', QuaternionKeyframeTrack, times, quaternions, qInterpolations));
        // tracks.push( this.createTrack('.camera.position', VectorKeyframeTrack, times, positions, pInterpolations));
        // tracks.push( this.createTrack('.camera.fov', NumberKeyframeTrack, times, fovs, fInterpolations));

        let animClip = new AnimationClip( 'camera', -1, tracks );
        return animClip;
    }

    buildIK (iks) {
        let iktracks = {};
        iks.sort((a,b) => {return a.frame - b.frame});
        for (let entry of iks) {
            for (let e of entry.iks) {
                if (this.config && this.config.bones[e.name]) {
                    iktracks[this.config.bones[e.name]] = iktracks[this.config.bones[e.name]] || [];
                    iktracks[this.config.bones[e.name]].push( {
                        frame: entry.frame,
                        show: entry.show,
                        enable: e.enable
                    })
                }
            }
        }

        let ikval = [];
        for (let key in iktracks) {
            let array = iktracks[key];
            let times = [];
            let enable = [];
            let show = [];
            for (let e of array) {
                times.push(e.frame/30.0);   // 30fps
                enable.push(e.enable);
                show.push(e.show);
           }
           ikval.push ({
               name: key,
               times: times,
               enable: enable,
               show: show
           })
        }

        return ikval;
    }

    // According to MMDLoader, .optimize() does not optimize interpolations
    // Below code is copied directly from MMDLoader
    createTrack (node, typedKeyframeTrack, times, values, interpolations ) {
        // if ( times.length > 2 ) {
        //     times = times.slice();
        //     values = values.slice();
        //     interpolations = interpolations.slice();
        //     let stride = values.length / times.length;
        //     let interpolateStride = interpolations.length / times.length;

        //     let index = 1;
        //     for ( let aheadIndex=2, endIndex=times.length; aheadIndex<endIndex; aheadIndex++ ) {
        //         for ( let i=0; i<stride; i++ ) {
        //             if ( values[ index * stride + i ] !== values[ ( index - 1 ) * stride + i ] ||
        //                 values[ index * stride + i ] !== values[ aheadIndex * stride + i ] ) {
        //                 index ++;
        //                 break;
        //             }
        //         }

        //         if ( aheadIndex > index ) {
        //             times[ index ] = times[ aheadIndex ];
        //             for ( var i = 0; i < stride; i ++ ) {
        //                 values[ index * stride + i ] = values[ aheadIndex * stride + i ];
        //             }
        //             for ( var i = 0; i < interpolateStride; i ++ ) {
        //                 interpolations[ index * interpolateStride + i ] = interpolations[ aheadIndex * interpolateStride + i ];
        //             }
        //         }
        //     }

        //     times.length = index + 1;
        //     values.length = ( index + 1 ) * stride;
        //     interpolations.length = ( index + 1 ) * interpolateStride;
        // }

        let track = new typedKeyframeTrack( node, times, values );
        track.createInterpolant = function ( result ) {
             return new CubicBezierInterpolation( this.times, this.values, this.getValueSize(), result, new Float32Array(interpolations)  );
        };
        return track.optimize();
    }

    mergeTracks ( ...tracks ) {
        let results = [];
        for (let track of tracks) {
            for (let key of track) {
                let fnum = key.frame;
                if (results.find(f => f.frame == fnum)) continue;
                let pos = new Vector3();
                let rot = new Quaternion();
                for (let t of tracks) {
                    let key2 = t[0].name === key.name ? key : VMDUtils.lerp(t, fnum);
                    pos.add(new Vector3().copy(key2.position))//.applyQuaternion(rot);
                    rot.multiply(key2.quaternion);
                }
                results.push({
                    name: key.name,
                    frame: fnum,
                    position: pos,
                    quaternion: rot
                })
            }
        }
        return results;
    }

    localTracks ( ...tracks ) {
        let results = [];
        let name = tracks[0][0].name;
        let isChild = false;
        for (let track of tracks) {
            for (let key of track) {
                let fnum = key.frame;
                if (results.find(f => f.frame == fnum)) continue;
                let fp = isChild ? VMDUtils.lerp(tracks[0], fnum) : key;
                let fc = isChild ? key : VMDUtils.lerp(tracks[0], fnum);
                results.push({
                    name: name,
                    frame: fnum,
                    position: (fc.isNew ? fc.position : fc.position.clone()).sub(fp.position),
                    quaternion: (fc.isNew ? fc.quaternion : fc.quaternion.clone()).multiply(new Quaternion().copy(fp.quaternion).invert())
                })
            }
            isChild = true;
        }
        return results;
    }

    localOffset(offset, child, parent, correctZ=false) {
        let results = [];
        for (let track of [child, parent]) {
            for (let key of track) {
                let fnum = key.frame;
                if (results.find(f => f.frame == fnum)) continue;

                let parentKey = VMDUtils.lerp(parent, key.frame);
                let childKey = VMDUtils.lerp(child, key.frame);
                //let pos = new Vector3().copy(childKey.position);
                let pos = childKey.position.clone();
                // rotate child and correct for -z axis
                const parentRot = !correctZ ? parentKey.quaternion.clone() : parentKey.quaternion.clone().multiply(Y_180);;
                //const offsetPos = new Vector3().copy(offset).applyQuaternion(parentRot);
                const offsetPos = offset.clone().applyQuaternion(parentRot);
                pos.add(offsetPos);

                results.push({
                    name: childKey.name,
                    frame: key.frame,
                    position: pos,
                    quaternion: childKey.quaternion,
                    bezier: (key.bezier) ? key.bezier : child[0].bezier
                })    
            }
        }
        return results.sort((a,b) => {return a.frame - b.frame});
    }

    restoreBezier ( dest, source ) {
        for (let d of dest ) {
            let index = source.findIndex(s => s.frame == d.frame)
            if (index < 0)
                d.bezier = source[0].bezier;
            else
                d.bezier = source[index].bezier;
        }
    }
}

const encode = 'shift_jis';
const headerByte = 50;
const headerByteOld = 40;
const boneByte = 111;
const morphByte = 23;
const cameraByte = 61;
const lightByte = 28;
const shadowByte = 9;
//const V3_ZERO = new Vector3();
//const Q_IDENTITY = new Quaternion();
const Z_30_DEG_CW = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI/6);
const Z_30_DEG_CCW = Z_30_DEG_CW.clone().invert();
const Y_180 = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), Math.PI);

class VMDReader {
    constructor(buffer, map) {
        this.meta = null;
        this.littleEndian = true;
        this.buffer = buffer;
        this.dataview = new DataView(buffer);
        this.map = map;
    }

    readMeta () {
        let begin, bone, camera, header, ik, light, morph, shadow;

        header = {};
        header.begin = 0;
        // crude version check
        if (this.dataview.getUint8(0x15) == 0x30) {
            header.byte = headerByte;
            header.signature = 30;
            header.name = 20;
            header.total = 50;    
        }
        else {
            header.byte = headerByteOld;
            header.signature = 30;
            header.name = 10;
            header.total = 40;    
        }
        begin = header.begin + (header.byte * 1);
  
        bone = {};
        bone.count = this.dataview.getUint32(begin, this.littleEndian);
        bone.begin = begin + 4;
        bone.byte = boneByte;
        bone.total = bone.byte * bone.count;
        begin = bone.begin + (bone.byte * bone.count);
        
        morph = {};
        morph.count = this.dataview.getUint32(begin, this.littleEndian);
        morph.begin = begin + 4;
        morph.byte = morphByte;
        morph.total = morph.byte * morph.count;
        begin = morph.begin + (morph.byte * morph.count);

        camera = {};
        camera.count = this.dataview.getUint32(begin, this.littleEndian);
        camera.begin = begin + 4;
        camera.byte = cameraByte;
        camera.total = camera.byte * camera.count;
        begin = camera.begin + (camera.byte * camera.count);

        if (this.dataview.byteLength > begin) {
          light = {};
          light.count = this.dataview.getUint32(begin, this.littleEndian);
          light.begin = begin + 4;
          light.byte = lightByte;
          light.total = light.byte * light.count;
          if (this.dataview.byteLength < light.begin + light.total) {
            light = null;
          }
        }
        begin = (light != null ? light.begin : void 0) + ((light != null ? light.byte : void 0) * (light != null ? light.count : void 0));

        if (this.dataview.byteLength > begin) {
          shadow = {};
          shadow.count = this.dataview.getUint32(begin, this.littleEndian);
          shadow.begin = begin + 4;
          shadow.byte = shadowByte;
          shadow.total = shadow.byte * shadow.count;
          if (this.dataview.byteLength < shadow.begin + shadow.total) {
            shadow = null;
          }
        }
        begin = (shadow != null ? shadow.begin : void 0) + ((shadow != null ? shadow.byte : void 0) * (shadow != null ? shadow.count : void 0));
        if (this.dataview.byteLength > begin) {
          ik = {};
          ik.count = this.dataview.getUint32(begin, this.littleEndian);
          ik.begin = begin + 4;
          ik.number = ik.count > 0 ? this.dataview.getUint32(begin + 4 + 5, this.littleEndian) : 0;
          ik.byte = 9 + 21 * ik.number;
          ik.total = ik.byte * ik.count;
          if (this.dataview.byteLength < ik.begin + ik.total) {
            ik = null;
          }
        }
        return {
          header: header,
          bone: bone,
          morph: morph,
          camera: camera,
          light: light,
          shadow: shadow,
          ik: ik
        };
    }

    readHeader() {
        let name, signature;
        this.meta = (this.readMeta());
        if (this.meta.header == null) {
          return [];
        }

        let dec = new TextDecoder('utf-8');
        signature = dec.decode(this.buffer.slice(0, this.meta.header.signature));

        let dec2 = new TextDecoder(encode);
        name = dec2.decode(this.buffer.slice(this.meta.header.signature, this.meta.header.signature + this.meta.header.name));
        if (name.indexOf('\u0000') >= 0)
            name = name.substring(0, name.indexOf('\u0000'));
        return {
          signature: signature.substring(0, signature.indexOf('\u0000')),
          name: name,
          motionCount: this.meta.bone.count,
          morphCount: this.meta.morph.count,
          cameraCount: this.meta.camera.count
        };
    }

    readBone() {
        let begin, bezier, frame, i, j, l, name, position, quaternion, ref, results;
        if (this.meta.bone == null) {
          return [];
        }
        results = [];
        let dec = new TextDecoder(encode);
        for (i=0, l=0, ref=this.meta.bone.count; 0<=ref ? l<ref : l>ref; i=0<=ref ? ++l : --l) {
            begin = this.meta.bone.begin + (this.meta.bone.byte * i);
            j = 0;
            name = dec.decode(this.buffer.slice(begin, begin + 15));
            j += 15;
            frame = this.dataview.getUint32(begin + j, this.littleEndian);
            j += 4;
            position = this.readVector3LE(begin + j);
            j += 12;
            quaternion = this.readVector4LE(begin + j);
            j += 16;
            bezier = this.getBezier(this.buffer.slice(begin + j, begin + j + 64));
            j += 64;
            if (name.indexOf('\u0000') >= 0)
                name = name.substring(0, name.indexOf('\u0000'));
            results.push({
                frame: frame,
                name: name,
                position: position,
                quaternion: quaternion,
                bezier: bezier
            });
        }
        return results;    
    }

    readMorph () {
        let begin, frame, i, j, l, name, ref, results, weight;
        if (this.meta.morph == null) {
          return [];
        }
        results = [];
        let dec = new TextDecoder(encode);
        for (i=l=0, ref=this.meta.morph.count; 0<=ref ? l<ref : l>ref; i=0<= ref ? ++l : --l) {
          begin = this.meta.morph.begin + (this.meta.morph.byte * i);
          j = 0;
          name = dec.decode(this.buffer.slice(begin, begin + 15));
          j += 15;
          frame = this.dataview.getUint32(begin + j, this.littleEndian);
          j += 4;
          weight = this.dataview.getFloat32(begin + j, this.littleEndian);
          j += 4;
          if (name.indexOf('\u0000') >= 0)
              name = name.substring(0, name.indexOf('\u0000'));
        results.push({
            frame: frame,
            name: name,
            weight: weight
          });
        }
        return results;
    
    }

    readIk () {
        let begin, count, enable, frame, i, iks, j, k, l, name, ref, results, show;
        if (this.meta.ik == null) {
          return [];
        }
        results = [];
        for (i=l=0, ref=this.meta.ik.count; 0<=ref ? l<ref : l>ref; i=0<=ref ? ++l : --l) {
          begin = this.meta.ik.begin + (this.meta.ik.byte * i);
          j = 0;
          frame = this.dataview.getUint32(begin + j, this.littleEndian);
          j += 4;
          show = (this.dataview.getUint8(begin + j)) === 1;
          j += 1;
          count = this.dataview.getUint32(begin + j, this.littleEndian);
          j += 4;
          iks = (function() {
            let m, ref1, results1;
            results1 = [];
            let dec = new TextDecoder(encode);
            for (k=m=0, ref1=count; 0<=ref1 ? m<ref1 : m>ref1; k=0<=ref1 ? ++m : --m) {
              name = dec.decode(this.buffer.slice(begin + j, begin + j + 20));
              j += 20;
              let tmp = this.dataview.getUint8(begin + j);
              enable = (this.dataview.getUint8(begin + j)) === 1;
              j += 1;
              if (name.indexOf('\u0000') >= 0)
                  name = name.substring(0, name.indexOf('\u0000'));
              results1.push({
                name: name,
                enable: enable
              });
            }
            return results1;
          }).call(this);
          results.push({
            frame: frame,
            show: show,
            count: count,
            iks: iks
          });
        }
        return results;    
    }

    readCamera() {
        let begin, bezier, frame, i, j, l, length, location, perspective, ref, results, rotation, viewAngle;
        if (this.meta.camera == null) {
            return [];
        }
        results = [];
        // TODO: no corrections, just read raw data
        for (i=l= 0, ref=this.meta.camera.count; 0<=ref ? l<ref : l>ref; i=0<= ref ? ++l : --l) {
          begin = this.meta.camera.begin + (this.meta.camera.byte * i);
          j = 0;
          frame = this.dataview.getUint32(begin + j, this.littleEndian);
          j += 4;
          length = (this.dataview.getFloat32(begin + j, this.littleEndian));// * -1; // TODO
          j += 4;
          location = this.readVector3LE(begin + j); //TODO: [1,1,-1]
        //   location.z = -location.z;
          j += 12;
          rotation = this.readVector3LE(begin + j);
          //rotation.x *= -1;   //TODO: [-1, -1, 1]
        //    rotation.x = -rotation.x;
        //    rotation.y = -rotation.y;
          j += 12;
          bezier = this.getBezierCamera(this.buffer.slice(begin + j, begin + j + 24));
          j += 24;
          viewAngle = this.dataview.getUint32(begin + j, this.littleEndian);
          j += 4;
          perspective = this.dataview.getUint8(begin + j);
          j += 1;
          results.push({
            frame: frame,
            distance: length,       // target-to-camera
            position: location,     // target position
            rotation: rotation,     // camera rotation
            bezier: bezier,
            fov: viewAngle,
            perspective: perspective
          });
        }
        return results;    
    }

    readVector3LE (offset) {
        let v = new Vector3();
        v.x = this.dataview.getFloat32(offset+0, this.littleEndian);
        v.y = this.dataview.getFloat32(offset+4, this.littleEndian);
        v.z = this.dataview.getFloat32(offset+8, this.littleEndian);
        return v; //[x, y, z]; // return as array
    }

    readVector4LE (offset) {
        let q = new Quaternion();
        q.x = this.dataview.getFloat32(offset+0, this.littleEndian);
        q.y = this.dataview.getFloat32(offset+4, this.littleEndian);
        q.z = this.dataview.getFloat32(offset+8, this.littleEndian);
        q.w = this.dataview.getFloat32(offset+12, this.littleEndian);
        return q; //[x, y, z, w];
    }

    getBezier (buffer) {
        let NOOP, r, x, y, z;
        let bezier = [];
        let dv = new DataView(buffer);
        for (let i=0; i<64; i++) {
            bezier.push (dv.getUint8(i));
        }
        x = {};
        y = {};
        z = {};
        r = {};
        x.x1 = bezier[0], y.x1 = bezier[1], z.x1 = bezier[2], r.x1 = bezier[3], x.y1 = bezier[4], y.y1 = bezier[5], z.y1 = bezier[6], r.y1 = bezier[7], x.x2 = bezier[8], y.x2 = bezier[9], z.x2 = bezier[10], r.x2 = bezier[11], x.y2 = bezier[12], y.y2 = bezier[13], z.y2 = bezier[14], r.y2 = bezier[15], y.x1 = bezier[16], z.x1 = bezier[17], r.x1 = bezier[18], x.y1 = bezier[19], y.y1 = bezier[20], z.y1 = bezier[21], r.y1 = bezier[22], x.x2 = bezier[23], y.x2 = bezier[24], z.x2 = bezier[25], r.x2 = bezier[26], x.y2 = bezier[27], y.y2 = bezier[28], z.y2 = bezier[29], r.y2 = bezier[30], NOOP = bezier[31], z.x1 = bezier[32], r.x1 = bezier[33], x.y1 = bezier[34], y.y1 = bezier[35], z.y1 = bezier[36], r.y1 = bezier[37], x.x2 = bezier[38], y.x2 = bezier[39], z.x2 = bezier[40], r.x2 = bezier[41], x.y2 = bezier[42], y.y2 = bezier[43], z.y2 = bezier[44], r.y2 = bezier[45], NOOP = bezier[46], NOOP = bezier[47], r.x1 = bezier[48], x.y1 = bezier[49], y.y1 = bezier[50], z.y1 = bezier[51], r.y1 = bezier[52], x.x2 = bezier[53], y.x2 = bezier[54], z.x2 = bezier[55], r.x2 = bezier[56], x.y2 = bezier[57], y.y2 = bezier[58], z.y2 = bezier[59], r.y2 = bezier[60], NOOP = bezier[61], NOOP = bezier[62], NOOP = bezier[63];
        return {
          x: x,
          y: y,
          z: z,
          r: r
        };
    }

    getBezierCamera (buffer) {
        let l, r, v, x, y, z;
        let bezier = [];
        let dv = new DataView(buffer);
        for (let i=0; i<24; i++) {
            bezier.push (dv.getUint8(i));
        }
        x = {};
        y = {};
        z = {};
        r = {};
        l = {};
        v = {};
        x.x1 = bezier[0], x.x2 = bezier[1], x.y1 = bezier[2], x.y2 = bezier[3], y.x1 = bezier[4], y.x2 = bezier[5], y.y1 = bezier[6], y.y2 = bezier[7], z.x1 = bezier[8], z.x2 = bezier[9], z.y1 = bezier[10], z.y2 = bezier[11], r.x1 = bezier[12], r.x2 = bezier[13], r.y1 = bezier[14], r.y2 = bezier[15], l.x1 = bezier[16], l.x2 = bezier[17], l.y1 = bezier[18], l.y2 = bezier[19], v.x1 = bezier[20], v.x2 = bezier[21], v.y1 = bezier[22], v.y2 = bezier[23];
        return {
          x: x,
          y: y,
          z: z,
          r: r,
          l: l,
          v: v
        };
    }
}

// again, copied from MMDLoader
class CubicBezierInterpolation extends Interpolant {
    constructor (parameterPositions, sampleValues, sampleSize, resultBuffer, params) {
        super( parameterPositions, sampleValues, sampleSize, resultBuffer );
		this.interpolationParams = params;
    }
    interpolate_( i1, t0, t, t1 ) {
        let result = this.resultBuffer;
        let values = this.sampleValues;
        let stride = this.valueSize;
        let params = this.interpolationParams;

        let offset1 = i1 * stride;
        let offset0 = offset1 - stride;
        let weight1 = ( ( t1 - t0 ) < 1 / 30 * 1.5 ) ? 0.0 : ( t - t0 ) / ( t1 - t0 );

        if ( stride === 4 ) { // Quaternion
            let x1 = params[ i1 * 4 + 0 ];
            let x2 = params[ i1 * 4 + 1 ];
            let y1 = params[ i1 * 4 + 2 ];
            let y2 = params[ i1 * 4 + 3 ];

            let ratio = this._calculate( x1, x2, y1, y2, weight1 );
            Quaternion.slerpFlat( result, 0, values, offset0, values, offset1, ratio );
        } else if ( stride === 3 ) { // Vector3

            for ( let i=0; i!==stride; ++ i ) {
                let x1 = params[ i1 * 12 + i * 4 + 0 ];
                let x2 = params[ i1 * 12 + i * 4 + 1 ];
                let y1 = params[ i1 * 12 + i * 4 + 2 ];
                let y2 = params[ i1 * 12 + i * 4 + 3 ];

                let ratio = this._calculate( x1, x2, y1, y2, weight1 );
                result[ i ] = values[ offset0 + i ] * ( 1 - ratio ) + values[ offset1 + i ] * ratio;
            }
        } else { // Number
            let x1 = params[ i1 * 4 + 0 ];
            let x2 = params[ i1 * 4 + 1 ];
            let y1 = params[ i1 * 4 + 2 ];
            let y2 = params[ i1 * 4 + 3 ];

            let ratio = this._calculate( x1, x2, y1, y2, weight1 );
            result[ 0 ] = values[ offset0 ] * ( 1 - ratio ) + values[ offset1 ] * ratio;
        }
        return result;
    }
    _calculate ( x1, x2, y1, y2, x )  {

        let c = 0.5;
        let t = c;
        let s = 1.0 - t;
        let loop = 15;
        let eps = 1e-5;
        let math = Math;
        let sst3, stt3, ttt;

        for ( let i = 0; i < loop; i ++ ) {
            sst3 = 3.0 * s * s * t;
            stt3 = 3.0 * s * t * t;
            ttt = t * t * t;

            let ft = ( sst3 * x1 ) + ( stt3 * x2 ) + ( ttt ) - x;
            if ( math.abs( ft ) < eps ) break;
            c /= 2.0;
            t += ( ft < 0 ) ? c : - c;
            s = 1.0 - t;
        }

        return ( sst3 * y1 ) + ( stt3 * y2 ) + ttt;
    }
}

class VMDUtils {

    static quaternionToAxisAngle(q) {
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

    static quaternionToEulerAngles(q) {     // MMD method: YXZ
        let m = new Matrix4();
        m.makeRotationFromQuaternion(q);

        let axis = [0,0,0];
        let angle = 2 * Math.acos(q.w);
        if (1 - (q.w*q.w) < 0.000001) {
            axis[0] = q.x;
            axis[1] = q.y;
            axis[2] = q.z;
        }
        else {
            let s = Math.sqrt(1 - (q.w*q.w));
            axis[0] = q.x/s;
            axis[1] = q.y/s;
            axis[2] = q.z/s;
        }
        
        let eu = new Euler();
        eu.setFromRotationMatrix(m, "YXZ");
        
        return {
            x:  eu.x,
            y: -eu.y,
            z: -eu.z
        }
    }

	static adjustXYZ(v) {
        return new Vector3(-v.x, v.y, v.z);
	}
	static adjustQ(q, name=null) {
        let newQ = new Quaternion(-q.x, q.y, q.z, -q.w);
        if (name) {
            switch (name) {
                case "LeftUpperArm":
                    newQ.multiply(Z_30_DEG_CW);
                    break;
                case "RightUpperArm":
                    newQ.multiply(Z_30_DEG_CCW);
                    break;
                case "LeftLowerArm":
                case "LeftHand":
                case "LeftThumb1":
                case "LeftThumb2":
                case "LeftThumb3":
                case "LeftIndex1":
                case "LeftIndex2":
                case "LeftIndex3":
                case "LeftMiddle1":
                case "LeftMiddle2":
                case "LeftMiddle3":
                case "LeftRing1":
                case "LeftRing2":
                case "LeftRing3":
                case "LeftLittle1":
                case "LeftLittle2":
                case "LeftLittle3":
                case "LeftArmTwist":
                case "LeftHandTwist":
                    newQ.premultiply(Z_30_DEG_CCW).multiply(Z_30_DEG_CW);
                    break;
                case "RightLowerArm":
                case "RightHand":
                case "RightThumb1":
                case "RightThumb2":
                case "RightThumb3":
                case "RightIndex1":
                case "RightIndex2":
                case "RightIndex3":
                case "RightMiddle1":
                case "RightMiddle2":
                case "RightMiddle3":
                case "RightRing1":
                case "RightRing2":
                case "RightRing3":
                case "RightLittle1":
                case "RightLittle2":
                case "RightLittle3":
                case "RightArmTwist":
                case "RightHandTwist":
                            newQ.premultiply(Z_30_DEG_CW).multiply(Z_30_DEG_CCW);
                    break;
                default:
                    break;
            }
        }
        return newQ;
	}

    static lerp (key, frame) {
        if (!key) return {
                boneName: '',
                frameNum,
                position: new Vector3(),
                quaternion: new Quaternion(),
              };

        let next = key.findIndex(k => k.frame > frame)
        switch (next) {
            case 0: return key[0];
            case -1: return key[key.length-1];
            case frame: return key[frame];
            default:
                let prevFrame = key[next-1];
                let nextFrame = key[next];
                let weight = (frame - prevFrame.frame) / (nextFrame.frame - prevFrame.frame);
                return {
                    name: key[0].name,
                    frame: frame,
                    position: prevFrame.position.clone().lerp(nextFrame.position, weight),
                    quaternion: prevFrame.quaternion.clone().slerp(nextFrame.quaternion, weight),
                    isNew: true
                }
        }
    }

    static toRightVector3(v) {
        v.z = -v.z;
        return v;
        //v[0] = -v[0];
        //v[2] = -v[2];
        //return v;
    }
    static toRightQuaternion(q) {
         q.x = -q.x;
         q.y = -q.y;
         return q;
        //q[0] = -q[0];
        //q[1] = -q[1];
        //return q;
    }

    static toRightEuler(e) {
        e.x = -e.x;
        e.y = -e.y;
        return e;
    }

    computeOffset () {
        function calculatePos(from=null, to=null) {
            let current = to;
            const chain = [to];
            while (current.parent && current != from) {
                chain.push(current.parent);
                current = current.parent;
            }
            if (current == null)  return;
            chain.reverse();
            const position = new THREE.Vector3(0,0,0);
            for (const node of chain) {
                position.add(node.position);
            }
            return position;
        }

        const humanoid = this.vrm.humanoid;
        const currentPose = humanoid.getPose();
        humanoid.resetPose();
        const hipBone = humanoid.getBoneNode("hips");
        const leftFootBone = humanoid.getBoneNode("leftFoot");
        const leftToesBone = humanoid.getBoneNode("leftToes")
        const rightFootBone = humanoid.getBoneNode("rightFoot");
        const rightToesBone = humanoid.getBoneNode("rightToes")
        humanoid.setPose( currentPose );
        return {
            hipsOffset: calculatePos(hipBone, hipBone),
            leftFootOffset: calculatePos(hipBone, leftFootBone),
            leftToesOffset: calculatePos(leftFootBone, leftToesBone),
            rightFootOffset: calculatePos(hipBone, rightFootBone),
            rightToesOffset: calculatePos(rightFootBone, rightToesBone)
        }
    }

}

export { VMDLoader }