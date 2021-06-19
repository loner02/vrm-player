import * as THREE from '/build/three.module.js'
import * as ThreeVRM from '/lib/three-vrm.module.js'
import { MorphPlayer } from './morphPlayer.js'
import { GLTFLoader } from '/jsm/loaders/GLTFLoader'
import { VRMIkHandler } from './ikHandler.js' 



class Avatar {
    /**
     * Loads a new Avatar on the scene
     * @param {string} id Name tag for avatar
     */
    constructor (id, world) {
        this.id = id;
        this.world = world;

        this.gltf = undefined;
        this.vrm = undefined;
        this.mixer = undefined;
        this.loader = new GLTFLoader();
        this.handler = new VRMIkHandler(world.scene);
        this.actions = new Map();
        this.currentAction = '';
        this.pauseAction = false;
        this.camActions = new Map();
        this.config = undefined;
        this.base = undefined;
        this.morphs = undefined;
        this.audio = undefined;
        this.listener = undefined;
        this.soundBuffer = undefined;
        this.boneOffsets = undefined;

        this._debug = false;
        this._visible = true;
        this._position = [0,0,0];
    }

    // SETTERS/GETTERS
    set animation (val) {
        this.loadAnimation(val, true);
        console.log("Motion: "+this.currentAction);
    }
    set debug (val) {
        this._debug = val;
    }
    set visible (val) {
        this._visible = val;
        this.vrm.scene.visible = this._visible;
    }
    set position (val) {
        this._position = val;
    }
    get animation () { 
        return this.currentAction;
    }
    get positionX () {
        return this._position[0];
    }
    get positionY () {
        return this._position[1];
    }
    get positionZ () {
        return this._position[2];
    }
    get position () {
        return this._position;
    }

    /**
     * Initialize model
     * @param {string} url VRM filename (assumes inside /assets/avatar/ folder)
     * @param {World class} world World instance to load avatar to
     * @param {Map} base Map to find animations
     * @param {Map} sounds Map to find sounds
     */
    async init (url, base=null, sounds=null, debug=false) {
        this._debug = debug;
        this.loader.crossOrigin = 'anonymous';
        this.gltf = await this.loader.loadAsync(url, //'assets/avatar/'+url,
            ( progress ) => console.log( 'Loading model...', 100.0 * ( progress.loaded / progress.total ), '%' )
        );

        // TODO: read additional settings from JSON file
        await fetch('/assets/avatar/Vroid.config.json')
            .then(res => res.json())
            .then(data => this.config = data );

        // // calling this function greatly improves the performance
        ThreeVRM.VRMUtils.removeUnnecessaryJoints( this.gltf.scene );

        // create a new Animation mixer
        this.mixer = new THREE.AnimationMixer(this.gltf.scene);
        this.mixer.addEventListener('finished', (e) => {
            // console.log("Finished1");
            this.world.activeCamera = this.world.orbitCam;
            //this.world.activeCamera.aspect = window.innerWidth / window.innerHeight;
            this.world.activeCamera.updateProjectionMatrix();
        });
        this.base = (base) ? base : null;
        // generate VRM instance from gltf
        // THREE.VRM.from( gltf ).then( ( vrm ) => {
        // THREE.VRMDebug.from( gltf ).then( ( vrm ) => {
        const lookAtImporter = new VRMSmoothLookAtImporter();
        const materialImporter = new ThreeVRM.VRMMaterialImporter( {
            // specifies input colorspace
            encoding: THREE.sRGBEncoding
        } );

        this.vrm = await ThreeVRM.VRM.from( this.gltf, { lookAtImporter, materialImporter });
        // compute select bone offsets (hip, foot, toe) for animation/IK computation and scaling
        this.computeOffsets ();
        this.world.scene.add( this.vrm.scene );

        if (debug) {
            console.log(this.gltf);
            console.log( this.vrm );
        }

        // look for blendShapes
        this.morphs = {};
        for (let expression of this.vrm.blendShapeProxy.expressions ) {
            this.morphs[expression] = new MorphPlayer(this.vrm, expression);
        }

        if (this.world.listener) {
            this.listener = this.world.listener;
            this.audio = new THREE.Audio(this.listener);
            this.soundBuffer = sounds;
        }

        // TODO: Experimental
        // Add Extra rig, to be compatible with PMX TDA models
        // Should not affect regular FBX or BVH animations
        this.addExtraRig();

        // Add IK rig for VRM: standard VRM do not have IK bones
        this.handler.addIKRig(this.vrm, this.config.bones);        
        this.computeIKOffsets();
        if (this._debug) this.handler.createHelper(this.vrm);

        this.skeletonHelper = new THREE.SkeletonHelper(this.vrm.scene);
        this.skeletonHelper.visible = false;
        this.world.scene.add(this.skeletonHelper);

        // Get all idle animations
        this.idleAnimations = [];
        for (let [key, value] of this.base) {
            if (key.includes("Idle")) {
                this.loadAnimation(key, false);
                let action = this.actions.get(key);
                action.paused = true;
                if (key !== "Idle.0") {
                    action.loop = THREE.LoopOnce;
                    action.clampWhenFinished = true;
                    action.getMixer().addEventListener( 'finished', (e) => {
                        // console.log("Finished2");

                        this.play("Idle.0");    // revert to Idle.0
                    })
                }
                else {
                    action.loop = THREE.LoopRepeat;
                }
                this.idleAnimations.push(key);
            }
        }

    }
  
    // Default/Base VRM does not have animation clips
    // This method loads a compatible animation file inside a GLB to the avatar
    /**
     * Imports animation file to model
     * TODO: Tpose adjustment, e.g. fingers may not appear right depeding on animation file
     * @param {string} id Name of animation
     * @param {Boolean} play Play loaded animation, default=true
     */
    loadAnimation(id, play=true) {           
        if (!this.base || !this.base.get(id)) return;
        let refAnimation = this.base.get(id);
        if (!this.mixer._actions.find(a => a._clip.name === id)) {
            let newTracks = [];
            const tracks = refAnimation.clip.tracks;
            const morphs = refAnimation.morph ? refAnimation.morph.tracks : null;
            const camera = refAnimation.camera ? refAnimation.camera.tracks : null;
            if (tracks) {
                for (let track of tracks) {
                    let name = track.name.split('.');
                    if (this.config.bones[name[1]]
                        && (!name[1].includes("Bust") ||
                            !name[1].includes("Eye"))    // let physics handle these bones
                        && name[2].includes('quaternion')) {
                            // check: retarget Hip quaternion to Center
                            newTracks.push (new THREE.QuaternionKeyframeTrack (
                                name[1].includes("Hip") && !refAnimation.useExtraRig ? 
                                    'Center.'+name[2] :
                                    this.config.bones[name[1]]+'.'+name[2],
                                track.times, track.values
                            ))
                        }
                    else if (name[2].includes('position') 
                            && (name[1].includes("Hip") ||
                                name[1].includes("Center") || 
                                name[1].includes("Root"))) {
                        // determine/infer scale
                        const hipDest = this.boneOffsets.hipsOffset;
                        if (refAnimation.skeleton) {
                            // FBX or BVH animations
                            const hipSrc = refAnimation.skeleton.bones.find(b => b.name === 'Hips').position;
                            const scale = hipDest.y / hipSrc.y;    
                            // Check: retarget and offset Hips position to Center
                            newTracks.push (new THREE.VectorKeyframeTrack (
                                name[1].includes("Hip") && !refAnimation.useExtraRig ?
                                    "Center."+name[2] : 
                                    this.config.bones[name[1]]+'.'+name[2],
                                track.times, track.values.map(v => v*scale)
                            ))
                        }
                        else if (refAnimation.offsets) {
                            // VMD animations
                            // for VMD, only Root and Center positions are important
                            const hipSrc = refAnimation.offsets.center ? refAnimation.offsets.center : 12.78; // TODO: magic number for TDA
                            const scale = hipDest.y / hipSrc.y;
                            if (name[1].includes("Root") || name[1].includes("Center")) {
                                newTracks.push (new THREE.VectorKeyframeTrack (
                                    this.config.bones[name[1]]+'.'+name[2],
                                    track.times, track.values.map(v => v*scale)
                                ))
                            }
                        }
                    }
                    else if (name[2].includes('position') && name[1].includes("IK")) {
                        // Compute standard scaling for all axes using hip/center y offsets
                        const hipDest = this.boneOffsets.hipsOffset;
                        const hipSrc = refAnimation.offsets.center ? refAnimation.offsets.center : 12.78;
                        const scale = hipDest.y / hipSrc.y;
                        let ikTracks = track.values.map(v => v*scale);
                        // Get local offset 
                        // BUG: need parent rotation for proper offset
                        //      Toe offset need to be aligned to Foot
                        //      Foot offset need to be aligned to Parent; however, foot offset is typically vertical
                        // let offsetVector = this.boneOffsets[name[1]];
                        // for (let i=0; i<ikTracks.length; i+=3) {
                        //     ikTracks[i+0] += offsetVector.x;
                        //     ikTracks[i+1] += offsetVector.y;
                        //     ikTracks[i+2] += offsetVector.z;
                        // }

                        newTracks.push (new THREE.VectorKeyframeTrack (
                            name[1]+'.'+name[2],
                            track.times, ikTracks
                        ))
                    }
                }
                this.checkIK (id);
            }
            if (morphs) {
                // append to newTracks
                for (let morph of morphs) {
                    let name = morph.name.split('.');
                    if (this.config.morphs[name[1]]) {
                            newTracks.push (new THREE.NumberKeyframeTrack (
                                //this.config.morphs[name[1]]+'.weight',
                                'BlendShapeController_'+this.config.morphs[name[1]]+'.weight',
                                morph.times, morph.values
                            ))
                        }
                }
            }
            const newClip = new THREE.AnimationClip (id, -1, newTracks);
            const newAction = this.mixer.clipAction( newClip );
            if (refAnimation.loop) newAction.setLoop(refAnimation.loop);
            this.actions.set(id, newAction);
            if (this._debug) console.log(this.actions);

            if (camera) {
                // load animation tracks to world camera
                let camTracks = [];
                for (let track of camera) {
                    if (track.name.includes('position')) {
                        for (let i=0; i<track.values.length; i=i+3) {
                            track.values[i+0] *= 0.08;
                            track.values[i+1] = 0.08*track.values[i+1] + 0.2;
                            track.values[i+2] *= 0.08;
                        }
                        camTracks.push(new THREE.VectorKeyframeTrack(track.name, 
                            track.times, track.values));
                    }
                    else {
                        camTracks.push(track);
                    }
                }
                const camClip = new THREE.AnimationClip('camera', -1, camTracks);
                const newAction = this.world.cameraMixer.clipAction( camClip );
                if (refAnimation.loop) newAction.setLoop(refAnimation.loop);
                this.camActions.set(id, this.world.cameraMixer.clipAction( camClip ));
                if (this._debug) console.log (camera);
            }
        }
        if (play) this.play(id);
        else this.pause(id);
    }

    checkIK (id) {
        let refAnimation = this.base.get(id);
        if (refAnimation.ik && (refAnimation.ik.length > 0)) {
            // enable or disable ik: for now, support only frame0 setting
            this.ikEnabled = false;
            for (let IK of this.handler.IK) {
                const ikConfig = refAnimation.ik.find(c => c.name===IK.target);
                for (let link of IK.links) {
                    link.enabled = ikConfig.enable[0];
                    if (link.enabled) this.ikEnabled = true;
                }
            }
        }
        else {
            // loaded anumation does not have IK config; assume disabled
            // Workaround: Some VMDs have IK enabled but no IK section
            //             Create new VMD by loading to MMD and saving as.
            this.ikEnabled = false;
            for (let IK of this.handler.IK) {
                for (let link of IK.links) {
                    link.enabled = false;
                }
            }    
        }
    }

    play (id) {
        console.log(`PLAY ${id}`);
        // check if already playing
        if (this.currentAction && this.currentAction == id) return;

        this.pauseAction = false;
        this.actions.get(id).paused = false;

        // check IKs for animation=id
        this.checkIK (id);

        if (this.currentAction && this.currentAction != id) {
            this.actions.get(id)
                .reset()
                .crossFadeFrom(this.actions.get(this.currentAction), 1)
                .play();
        }
        else {
            this.actions.get(id)
                .reset()
                .play();
        }
        if (this.base.get(id).hasAudio) {
            this.audio.setBuffer( this.soundBuffer.get(id) );
            this.audio.setLoop( false );
            this.audio.setVolume( 0.5 );
            this.audio.play();        
        }
        else {
            if (this.audio.isPlaying) this.audio.stop();
        }
        if (this.camActions.get(id)) {    // TODO: how to know camera has animations
            this.camActions.get(id)
                .reset()
                .play();
            this.world.activeCamera = this.world.animationCam;
            // this.world.updateCam = true;
        }
        else {
            this.world.activeCamera = this.world.orbitCam;
        }
        this.currentAction = id;
    }

    pause (id) {
        console.log(`PAUSE ${id}`);
        // play a single frame to pose avatar
        if (this.currentAction && this.currentAction != id) {
            this.actions.get(id)
                .crossFadeFrom(this.actions.get(this.currentAction), 1)
                .play();
        }
        else {
            this.actions.get(id).play();
        }
        this.pauseAction = true;
        // stop camera if exists
        if (this.currentAction && this.camActions.get(this.currentAction)) {
            console.log("cam stop?");
            this.camActions.get(this.currentAction)
                .reset()
                .stop();
        }
        // set currentAction as id
        this.currentAction = id;
    }

    // special handling for idle
        // Idle.0 is default action
        // Every params.interval, a random idle animation is played once
        //  then returns back to idle.0

    doIdle (params) {
        if (params.enable === false) {
            if (this.idleTimer) clearTimeout(this.idleTimer);
            this.idleTimer = null;
            this.actions.get("Idle.0").paused = true;
            // or get current active animation and pause
            return;
        }

        this.ikEnabled = false;
        if (!params.interval) params.interval = 60.0;
        let scope = this;
        if (!this.idleTimer) idling("Idle.0");

        function idling(id) {
            // console.log(id);
            scope.play(id);

            let anim = Math.round((scope.idleAnimations.length-2)*Math.random() + 1);
            if (params.enable) {
                scope.idleTimer = setTimeout(idling,
                    // do a 90% to 110% random interval
                    params.interval * (200 * Math.random() + 900),
                    "Idle."+anim)
            }
        }       
    }

    doAnimation (params) {
        if (!params.enable) {
            // stop current running animation
            // if (this.currentAction) {
            //     this.actions.get(this.currentAction).paused = true;
            // }
            // stop camera if running
            for (let [key, value] of this.camActions) {
                if (value.enabled && !value.paused) value.reset().stop();
            }
            //revert back to idle
            this.doIdle( {enable:true} );
            this.doBlink( {enable:true} );
            return;
        }

        this.doIdle( {enable:false} );
        this.loadAnimation(params.id, params.autoplay);
        let action = this.actions.get(params.id);
        if ( action.loop == THREE.LoopOnce) {
            // TODO: this must be a VMD
            this.doBlink( {enable:false} );

            action.clampWhenFinished = true;
            action.getMixer().addEventListener( 'finished', (e) => {
                // console.log("Finished3");

                // action.reset().stop();
                this.doIdle( {enable:true} );
                this.doBlink( {enable:true} );
                if (params.callback) params.callback();
            })
        }
    }

    /**
     * Set blendShapes on model
     * @param {string} id BlendShape/Morph name
     * @param {Float} value Value from 0 to 1
     * @param {Float} duration Time in sec
     */
    startMorph (id, value, duration=-1) {
        this.morphs[id].start(value, duration);
    }

    /**
     * Stop blendShapes on model
     * @param {string} id BlendShape/Morp name
     */
    endMorph (id) {
        this.morphs[id].end();
    }

    // special handling for autoblink
    doBlink (params) {
        if (!params.enable) {
            if (this.blinkTimer) clearTimeout(this.blinkTimer);
            this.blinkTimer = null;
            return;
        }
        let scope = this;
        if (!params.interval) params.interval = 5.0;
        if (!this.blinkTimer) blinking();

        function blinking() {
            scope.startMorph("Blink", 1, 0.1);
            if (params.enable)
                // do a 60% - 100% random interval
                scope.blinkTimer = setTimeout(blinking, 
                    params.interval * (400 * Math.random() + 600));
        };    
    }

    // user controls for Actor
    doUserActions (params) {
        this.debug = (params.debug != null) ? params.debug : false;
        this.visible = (params.visible != null) ? params.visible : true;

        if (params.posX!=null || params.posY!=null || params.posZ!=null ) {
            const rootPos = new THREE.Vector3();
            const root = this.vrm.scene.children.find(s => s instanceof THREE.Bone);
            rootPos.copy(root.position);
            if (params.posX != null) rootPos.x -= (params.posX + this.positionX);
            if (params.posY != null) rootPos.y += (params.posY - this.positionY);
            if (params.posZ != null) rootPos.z -= (params.posZ + this.positionZ);
            this.position = [rootPos.x, rootPos.y, rootPos.z];
            root.position.copy(rootPos);
        }
    }

    // Some utilities
    computeOffsets () {
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
        this.boneOffsets = {
            hipsOffset: calculatePos(hipBone, hipBone),
            leftFootOffset: calculatePos(hipBone, leftFootBone),
            leftToesOffset: calculatePos(leftFootBone, leftToesBone),
            rightFootOffset: calculatePos(hipBone, rightFootBone),
            rightToesOffset: calculatePos(rightFootBone, rightToesBone)
        }
    }

    computeIKOffsets() {
        const root = this.vrm.scene.children.find(s => s instanceof THREE.Bone);
        // get local offsets
        this.boneOffsets["RightFootIKParent"] = new THREE.Vector3().copy(root.getObjectByName("RightFootIKParent", true).position);
        this.boneOffsets["RightFootIK"] = new THREE.Vector3().copy(root.getObjectByName("RightFootIK", true).position);
        this.boneOffsets["RightToeIK"] = new THREE.Vector3().copy(root.getObjectByName("RightToeIK", true).position);
        this.boneOffsets["LeftFootIKParent"] = new THREE.Vector3().copy(root.getObjectByName("LeftFootIKParent", true).position);
        this.boneOffsets["LeftFootIK"] = new THREE.Vector3().copy(root.getObjectByName("LeftFootIK", true).position);
        this.boneOffsets["LeftToeIK"] = new THREE.Vector3().copy(root.getObjectByName("LeftToeIK", true).position);
        // console.log(this.boneOffsets);
    }

    // VRM skeleton do not have Center, Groove and Waist bones
    // Update: add arm/wrist twist bones
    addExtraRig() {
        // Add Hip colocated bones
        // VRM Hierarchy: Root --> Hips --> Spine
        //                              --> R/L UpperLeg
        // Hierarchy: Root --> Center --> Groove --> Waist --> Hips --> R/L UpperLeg
        //                                                 --> Spine
        // As a consequence, Hip animations for BVH,FBX may need to be remapped to Waist bone
        // console.log(this.boneOffsets);
        const rootBone = this.vrm.scene.children.find(s => s instanceof THREE.Bone);
        const centerBone = new THREE.Bone();
        centerBone.name = "Center";
        centerBone.position.copy(this.boneOffsets.hipsOffset);
        rootBone.add(centerBone);
        const grooveBone = new THREE.Bone();
        grooveBone.name = "Groove";
        grooveBone.position.set(0,0,0);
        centerBone.add(grooveBone);
        const waistBone = new THREE.Bone();
        waistBone.name = "Waist";
        waistBone.position.set(0,0,0);
        grooveBone.add(waistBone);
        // reparent Hips and Spine
        const hipBone = this.vrm.humanoid.getBoneNode("hips");
        hipBone.position.set(0,0,0);
        waistBone.add(hipBone);
        const spineBone = this.vrm.humanoid.getBoneNode("spine");
        waistBone.add(spineBone);

        // Add twist bones and reparent original
        // Issue: twist bones are axis limited to parent bone axis
        const lUpperArmBone = this.vrm.humanoid.getBoneNode("leftUpperArm")
        const lLowerArmBone = this.vrm.humanoid.getBoneNode("leftLowerArm")
        const lHandBone = this.vrm.humanoid.getBoneNode("leftHand");
        const lArmTwistBone = new THREE.Bone();
        lArmTwistBone.name = "LeftArmTwist";
        lArmTwistBone.position.copy(lLowerArmBone.position);
        lLowerArmBone.position.set(0,0,0);
        lUpperArmBone.add(lArmTwistBone);
        lArmTwistBone.add(lLowerArmBone);
        const lWristTwistBone = new THREE.Bone();
        lWristTwistBone.name = "LeftWristTwist";
        lWristTwistBone.position.copy(lHandBone.position);
        lHandBone.position.set(0,0,0);
        lLowerArmBone.add(lWristTwistBone);
        lWristTwistBone.add(lHandBone);

        const rUpperArmBone = this.vrm.humanoid.getBoneNode("rightUpperArm")
        const rLowerArmBone = this.vrm.humanoid.getBoneNode("rightLowerArm")
        const rHandBone = this.vrm.humanoid.getBoneNode("rightHand");
        const rArmTwistBone = new THREE.Bone();
        rArmTwistBone.name = "RightArmTwist";
        rArmTwistBone.position.copy(rLowerArmBone.position);
        rLowerArmBone.position.set(0,0,0);
        rUpperArmBone.add(rArmTwistBone);
        rArmTwistBone.add(rLowerArmBone);
        const rWristTwistBone = new THREE.Bone();
        rWristTwistBone.name = "RightWristTwist";
        rWristTwistBone.position.copy(rHandBone.position);
        rHandBone.position.set(0,0,0);
        rLowerArmBone.add(rWristTwistBone);
        rWristTwistBone.add(rHandBone);
    }

    addIKHelpers () {
        if (!this._debug)  return;
        this.handler.createHelper(this.vrm);
    }

    enableShadowMap () {
        this.vrm.scene.traverse( n => {
            if (n.isMesh) {
                n.castShadow = true;
                n.receiveShadow = true;
            }
        })
    }


    /**
     * Update loop for actor
     * @param {Float} delta Elapsed time
     */
    update ( delta ) {
        for (let expression of this.vrm.blendShapeProxy.expressions ) {
            this.morphs[expression].update( delta );
        }
        this.vrm.update( delta );    
        this.mixer.update( delta );
        if (this.currentAction && this.pauseAction)
            this.actions.get(this.currentAction).paused = true;

        // update IKs here
        if (this.ikEnabled) {
            this.vrm.scene.updateMatrixWorld (true);
            this.handler.update(this.vrm);
        }

        // debug
        this.skeletonHelper.visible = this._debug;
    }
}

/**
 * Advanced lookat
 */
const _v3A = new THREE.Vector3();
// extended lookat
class VRMSmoothLookAtHead extends ThreeVRM.VRMLookAtHead {
    constructor( firstPerson, applyer ) {
        super( firstPerson, applyer );
        this.smoothFactor = 10.0;
        this.horizontalLimit = Math.PI / 4.0;
        this.verticalLimit = Math.PI / 4.0;
        this._eulerTo = new THREE.Euler( 0.0, 0.0, 0.0, ThreeVRM.VRMLookAtHead.EULER_ORDER );
    }
    update( delta ) {
        if ( this.target && this.autoUpdate ) {
            if ( ! this.applyer ) return;
            this._calcEuler( this._eulerTo, this.target.getWorldPosition( _v3A ) );
            if (
                this.horizontalLimit < Math.abs( this._eulerTo.y ) ||
                this.verticalLimit < Math.abs( this._eulerTo.x )
            ) {
                this._eulerTo.set( 0.0, 0.0, 0.0 );
            }
            const k = 1.0 - Math.exp( - this.smoothFactor * delta );
            this._euler.x += ( this._eulerTo.x - this._euler.x ) * k;
            this._euler.y += ( this._eulerTo.y - this._euler.y ) * k;
            this.applyer.lookAt( this._euler );
        }
    }
}
// extended lookat importer
class VRMSmoothLookAtImporter extends ThreeVRM.VRMLookAtImporter {
    import( gltf, firstPerson, blendShapeProxy, humanBodyBones ) {
        const vrmExt = gltf.parser.json.extensions && gltf.parser.json.extensions.VRM;
        if ( ! vrmExt ) return null;

        const schemaFirstPerson = vrmExt.firstPerson;
        if ( ! schemaFirstPerson ) return null;
        const applyer = this._importApplyer( schemaFirstPerson, blendShapeProxy, humanBodyBones );
        return new VRMSmoothLookAtHead( firstPerson, applyer || undefined );
    }
  
}

export { Avatar };