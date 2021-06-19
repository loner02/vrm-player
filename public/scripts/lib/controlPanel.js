import * as THREE from '/build/three.module.js'
import { GUI } from '/jsm/libs/dat.gui.module.js';
import { FBXAnimLoader } from './fbxAnimLoader.js'
import { BVHLoader } from './bvhLoader.js'
import { VMDLoader } from './vmdLoader.js'

class ControlPanel {
    constructor (world, actors) {
        this.world = world;
        this.actors = actors;
        this.panel = new GUI( {width:250} );

        this.settings = {
            'active': "",
            'Load Avatar...': (url) => {this.loadActor(url)},
            'Load Animation...': (url) => {this.loadAnimation(url)},
        }

        this.folder1 = this.panel.addFolder( 'Avatar' );
        this.folder1.add(this.settings, 'Load Avatar...');
        this.folder2 = this.panel.addFolder( 'Animation' );
        this.folder2.add(this.settings, 'Load Animation...');
        // this.folder3 = this.panel.addFolder( 'Morphs' );
        this.bvhfolder = this.folder2.addFolder( 'BVH' );
        this.fbxfolder = this.folder2.addFolder( 'FBX' );
        this.vmdfolder = this.folder2.addFolder( 'VMD' );
        // ...

        // this.actorList = new Set();
        this.actorControls = new Map();
        this.animateControls = new Map();

        this.folder1.open();
        this.folder2.open();
        this.bvhfolder.open();
        this.fbxfolder.open();
        this.vmdfolder.open();
    }

    async preloadAnimations( base, sounds ) {

        function readData (url, loader) {
            return new Promise (resolve => {
                loader.load(url, resolve);
            });
        }   

        let loader1 = new FBXAnimLoader();
        await loader1.init();
        let loader2 = new BVHLoader();
        await loader2.init(); // initialize boneMaps list
        let loader3 = new VMDLoader(this.world.scene);
        await loader3.init();

        // prefetch base animations here which are common to all models
        let motions = undefined
        await fetch(`/assets/motions/!motions.json`)
            .then(res => res.json())
            .then(data => motions = data.motions)
        // console.log(motions);

        let promiseArray = [];
        let camAnimations = new Map();
        for (let motion of motions) {
            let promise = null, promiseSequence = null, promiseAudio = null, promiseCamera = null;
            switch (motion.format) {
                case 'BVH':
                    if (Array.isArray(motion.url)) {
                        promiseSequence = [];
                        // baseAnimations.set(motion.name, new Map());
                        for (let m in motion.url) {
                            promiseSequence.push(
                                readData(motion.url[m], loader2).then(result => {
                                    // let resMap = new Map()
                                    // baseAnimations.get(motion.name).set(motion.name+'.'+m,result);
                                    base.set(motion.name+'.'+m,result);
                                })
                            )
                        }
                        this.addAnimation(motion.name, 'BVH');
                    }
                    else 
                        promise = readData(motion.url, loader2).then(result => {
                            this.addAnimation(motion.name, 'BVH');
                            base.set(motion.name, result);
                        });
                    break;
                case 'FBX':
                    promise = readData(motion.url, loader1).then(result => {
                        this.addAnimation(motion.name, 'FBX');
                        base.set(motion.name, result);
                    })
                    break;
                case 'VMD':
                    promise = readData(motion.url, loader3).then(result => {
                        this.addAnimation(motion.name, 'VMD');
                        base.set(motion.name, result);
                        base.get(motion.name).loop = THREE.LoopOnce;
                        base.get(motion.name).clampWhenFinished = true;
                    })
                    if (motion.audio) {
                        promiseAudio = readData(motion.audio, new THREE.AudioLoader()).then(result => {
                            // TODO: sync audio, audiomanager
                            sounds.set(motion.name, result);
                        })
                    }
                    if (motion.camera) {
                        promiseCamera = readData(motion.camera, loader3).then(result => {
                            //baseAnimations.get(motion.name).camera = result.camera;      
                            camAnimations.set(motion.name, result.camera);
                            camAnimations.get(motion.name).loop = THREE.LoopOnce;
                            camAnimations.get(motion.name).clampWhenFinished = true;
                        })
                    }
                    break;
                default:
                    console.error ('Unsupported motion format!');
                    break;
            }
            if (promise) promiseArray.push(promise);
            if (promiseSequence) {
                for (let p of promiseSequence)
                    promiseArray.push(p);
            }
            if (promiseAudio) promiseArray.push(promiseAudio);
            if (promiseCamera) promiseArray.push(promiseCamera);
        }
        // TODO remove 'await' to not wait before loading avatars
        await Promise.all(promiseArray).then(() => {
            // put camAnimations under baseAnimations
            for (let [key, value] of camAnimations) 
                base.get(key).camera = camAnimations.get(key);

            console.log(base)
            console.log("All animations loaded!")
        })
    }

    loadActor(url) {
        alert("Not yet implemented.");
        console.log(url);
    }

    addActor(name) {
        if (this.actorControls.has(name)) return;
        let control = this.folder1.addFolder( name );
        control.open();

        this.settings.active = name;
        this.settings[name+':visible'] = true;
        this.settings[name+':debug'] = false;
        this.settings[name+':posX'] = 0.0;
        this.settings[name+':posY'] = 0.0;
        this.settings[name+':posZ'] = 0.0;

        control.add(this.settings, name+':visible').onChange( (state) => {
            this.updateActor({id:name, visible:state});
        });;
        control.add(this.settings, name+':debug').onChange( (state) => {
            this.updateActor({id:name, debug:state});
        });
        control.add(this.settings, name+':posX', -2, 2, 0.1).listen().onChange( (val) => {
            this.updateActor({id:name, posX:val});
        });
        control.add(this.settings, name+':posY', -2, 2, 0.1).listen().onChange( (val) => {
            this.updateActor({id:name, posY:val});
        });;
        control.add(this.settings, name+':posZ', -2, 2, 0.1).listen().onChange( (val) => {
            this.updateActor({id:name, posZ:val});
        });;
        this.actorControls.set(name, control);

        // this is a new actor, put in idle state
        this.actors.get(name).doIdle({enable:true});
        this.actors.get(name).doBlink({enable:true});
    }

    updateActor( params ) {
        if (this.actors.has(params.id)) {
            let actor = this.actors.get(params.id);
            actor.doUserActions(params);
        }
    }

    loadAnimation(url) {
        alert("Not yet implemented.");
        console.log(url);
    }
    addAnimation(id, type) {
        if (id == 'Idle') return;   // don't add default animation
        if (this.animateControls.has(id)) return;
        this.settings[id] = false;
        let control;
        switch (type) {
            case 'BVH': 
                control = this.bvhfolder
                            .add( this.settings, id)
                            .onChange( state => {this.animate(id, state)});
                break;
            case 'FBX':
                control = this.fbxfolder
                            .add( this.settings, id)
                            .onChange( state => {this.animate(id, state)});
                break;
            case 'VMD':
                control = this.vmdfolder
                            .add( this.settings, id)
                            .onChange( state => {this.animate(id, state, true)});
                break;
            default:
                break;
        }
        if (control) {
            control.type = type;
            this.animateControls.set(id, control);
        }
    }

    animate(id, state, auto=true) {
        // console.log(`${id}:${state}`);
        let actor = this.actors.get(this.settings.active);
        if (!actor) return;

        let type = this.animateControls.get(id).type;
        for (let [key, value] of this.animateControls) {
            if (key != id) {
                if (value.type != type)
                    value.domElement.children[0].disabled = state;
                else {
                    value.domElement.children[0].disabled = state;
                    // TODO
                    // value.domElement.children[0].checked = false;
                    // value.domElement.children[0].value = false;
                }
            }
        }
        actor.doAnimation( {enable:state, id:id, autoplay:auto, 
            callback: () => {
                // called when animation has finished
                // console.log(id+" animation finished")
                for (let [key, value] of this.animateControls) {
                    if (key == id) 
                        value.domElement.children[0].checked = false;
                    else
                        value.domElement.children[0].disabled = false;
                }
            } 
        } );
    }
}

export { ControlPanel }