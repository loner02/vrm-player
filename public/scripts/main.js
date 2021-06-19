//import * as THREE from '/build/three.module.js'
import Stats from '/jsm/libs/stats.module.js';
import { MMDLoader } from '/jsm/loaders/MMDLoader'
import { MMDAnimationHelper } from '/jsm/animation/MMDAnimationHelper.js'
import { World } from './lib/world.js'
import { Avatar } from './lib/vrmAvatar.js'
import { ControlPanel } from './lib/controlPanel.js';

let world = undefined;
let actors = undefined;
let md = new MMDLoader();
let helper = new MMDAnimationHelper();
let IKhelpers = [];
const container = document.querySelector( '#container' );
let stats = new Stats();
container.appendChild( stats.dom );
let cPanel = undefined;

async function main() {
    let baseAnimations = new Map();
    let soundBuffer = new Map();
    actors = new Map();

    world = new World();
    await world.init();
    renderloop();

    cPanel = new ControlPanel(world, actors);
    // Preload animation files
    // Current animation file support
    //      BVH: Unity-chan, Mixamo
    //      FBX: Mixamo
    //      VMD: Vocaloid/MMD
    await cPanel.preloadAnimations(baseAnimations, soundBuffer);

    // DEBUG: ANIMATION ***********************************
    // md.loadVMD('/assets/motions/IA_Conqueror.vmd', (motion) => {
    //     console.log(motion);
    // })
    // let response = await fetch('/assets/motions/IA_Conqueror.vmd');
    // let blob = undefined;
    // if (response.ok) {
    //     blob = await response.arrayBuffer();
    // }
    // DEBUG: ANIMATION ***********************************
    // DEBUG: CAMERA ***********************************
    // md.loadVMD("/assets/camera/IA_Conqueror.vmd", (cam) => {
    //     let camClip = md.animationBuilder.buildCameraAnimation(cam);
    //     for (let entry of camClip.tracks) {
    //         if (entry.name.includes('position')) {
    //             entry.values = entry.values.map(v => v*0.08);
    //         }
    //     }
    //     console.log (camClip);
    //     helper.add( world.testCam, {
    //         animation: camClip
    //     } );
    // });
    // DEBUG: CAMERA ***********************************
    // DEBUG: IK ***************************************
    // md.loadWithAnimation('/assets/avatar/raw/TDA Miku base.pmx', 
    //                     '/assets/motions/So Sexy.vmd',
    //                     (model) => {
    //     let mesh = model.mesh;
    //     helper.add(mesh, {
    //         animation: model.animation,
    //         physics: false
    //     })
    //     world.scene.add(mesh);
    //     let sHelper = new THREE.SkeletonHelper(mesh);
    //     world.scene.add(sHelper);
    //     console.log(model);
    // })
    // DEBUG: IK ***************************************
 
    // Create new avatar
    // let actor = new Avatar('Fumiriya', world);
    // await actor.init('Fumiriya.vrm',
    let actor = new Avatar('Lei', world);
    await actor.init('https://cdn.glitch.com/3aab6bc9-e20d-4689-98cc-1b114af7f83a%2FLei.vrm?v=1623984664209',         // VRM url 
                    baseAnimations,     // where to find animations
                    soundBuffer,        // where to find sounds
                    //   true                // debug
                    );
    actor.vrm.lookAt.target = world.lookAtTarget;
    actor.enableShadowMap();
    actors.set(actor.id, actor);
    cPanel.addActor(actor.id);

    // DEBUG: IK ***************************************
    // actor.handler.enableIKs(true);
    // actor.ikEnabled = true;
    // let centerBone = actor.vrm.scene.getObjectByName("Center");
    // document.onkeydown = (e) => {
    //     console.log(e.key);
    //     switch(e.key) {
    //         case "ArrowUp":
    //             centerBone.position.y += 0.02;
    //             break;
    //         case "ArrowDown":
    //             centerBone.position.y -= 0.02;
    //             break;
    //         case "ArrowLeft":
    //             centerBone.position.x += 0.02;
    //             break;
    //         case "ArrowRight":
    //             centerBone.position.x -= 0.02;
    //             break;
    //         case "PageUp":
    //             centerBone.position.z += 0.02;
    //             // centerBone.rotation.y -= 0.1;
    //             break;
    //         case "PageDown":
    //             centerBone.position.z -= 0.02;
    //             // centerBone.rotation.y += 0.1;
    //             break;
    //         default:
    //             break;
    //     }
    // }
    // DEBUG: IK ***************************************
    // DEBUG: ARM twist ***************************************
    // let rArmTwistBone = actor.vrm.scene.getObjectByName("RightArmTwist");
    // let rArmBone = actor.vrm.humanoid.getBoneNode("rightUpperArm");
    // document.onkeydown = (e) => {
    //     console.log(e.key);
    //     switch(e.key) {
    //         case "ArrowUp":
    //             rArmTwistBone.rotation.x += 0.02;
    //             break;
    //         case "ArrowDown":
    //             rArmTwistBone.rotation.x -= 0.02;
    //             break;
    //         case "ArrowLeft":
    //             rArmTwistBone.rotation.y += 0.02;
    //             break;
    //         case "ArrowRight":
    //             rArmTwistBone.rotation.y -= 0.02;
    //             break;
    //         case "PageUp":
    //             rArmBone.rotation.z += 0.02;
    //             break;
    //         case "PageDown":
    //             rArmBone.rotation.z -= 0.02;
    //             break;
    //         default:
    //             break;
    //     }
    // }
    // DEBUG: ARM twist ***************************************

    // Special handling for IDLE
    // actor.doBlink( {enable:true, interval:5.0} );
    // actor.doIdle( {enable:true, interval:60.0} ); 

    // TODO: test/debug only
    //actor.startMorph("A", 0.5);

    // Do a sequnce of motions
    // actor.animation = "Jump00";
    // await delay(3);
    // actor.animation = "Run00";
    // await delay(3);
    // actor.animation = "Wait.4";
    // await delay(3);
    // actor.animation = "Belly01";
    // await delay(10);
    //  await delay(2);
    // actor.animation = "Conqueror";
    // actor.animation = "So Sexy";
    // actor.animation = "Follow the Leader";
    // actor.animation = "Rockabye";
    // actor.animation = "Bad Romance";
    // TEST: multiple actors
    // actor.loadAnimation("So Sexy", false);  // load animation on other actors and pose
    // await delay(8);
    // actor.play("So Sexy");                  // play in sync

    async function delay(timeout) {
        await new Promise (res => setTimeout(res, 1000*timeout));
    }

}
main().catch((err) => (console.error(err)));

// render loop
function renderloop() {
    window.requestAnimFrame( renderloop );

    stats.begin();

    const deltaTime = world.clock.getDelta();
    //world.activeCamera = world.orbitCam;
    // update all avatars
    for (let [key, value] of actors) {
        value.update( deltaTime );
    }
    // update world
    world.update( deltaTime );
    // DEBUG: CAMERA ***********************************
    // if (world.updateCam) {
    //     helper.update(deltaTime);
    //     world.testmesh.position.set (helper.cameraTarget.position.x,helper.cameraTarget.position.y,helper.cameraTarget.position.z);
    // }
    // DEBUG: CAMERA ***********************************
    // DEBUG: IK ***********************************
    // helper.update(deltaTime);
    // DEBUG: IK ***********************************

    stats.end();

}

// Function to determine optimal animation frame
window.requestAnimFrame = ((callback) => {
	return window.requestAnimationFrame ||
	window.webkitRequestAnimationFrame ||
	window.mozRequestAnimationFrame ||
	window.oRequestAnimationFrame ||
	window.msRequestAnimationFrame ||
	function(callback){
		window.setTimeout(callback, 1000 / 60);
	};
})();

// Helper function on window resize
window.onresize = (() => {
    world.activeCamera.aspect = window.innerWidth / window.innerHeight;
    world.activeCamera.updateProjectionMatrix();
    world.renderer.setSize( window.innerWidth, window.innerHeight );
});
