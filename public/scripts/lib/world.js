import * as THREE from '/build/three.module.js'
import { OrbitControls } from '/jsm/controls/OrbitControls'
import { EffectComposer } from '/jsm/postprocessing/EffectComposer.js';
import { SSRPass } from '/jsm/postprocessing/SSRPass.js';
import { Reflector } from '/jsm/objects/ReflectorForSSRPass.js';
import { RenderPass } from '/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/jsm/postprocessing/UnrealBloomPass.js';

class World {
    constructor () {
         // renderer
        this.renderer = new THREE.WebGLRenderer( {alpha:true, antialias:true} );
        this.renderer.setSize( window.innerWidth, window.innerHeight );
        this.renderer.setPixelRatio( window.devicePixelRatio );
        // set sRGBEncoding to output encoding to use linear colorspace
        this.renderer.outputEncoding = THREE.sRGBEncoding
        this.renderer.setClearColor(0xffffff, 0);
        // this.renderer.shadowMap.enabled = true;          <-- this produces fragment shader error
        // this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild( this.renderer.domElement );

        // scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color (0xF0F0F0);       
        // this.scene.fog = new THREE.Fog( 0x443333, 1, 25 );

        // Ground
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry( 20, 20 ),
            new THREE.MeshPhongMaterial( { shininess:80, color: 0x999999, specular: 0x101010 } )
        );
        plane.rotation.x = - Math.PI / 2;
        plane.position.y = - 0.0001;
        plane.receiveShadow = true;
        this.scene.add( plane );

        // const geometry = new THREE.PlaneBufferGeometry( 1, 1 );
        // let groundReflector = new Reflector( geometry, {
        //     clipBias: 0.0003,
        //     textureWidth: window.innerWidth,
        //     textureHeight: window.innerHeight,
        //     color: 0x888888,
        //     useDepthTexture: true,
        // } );
        // groundReflector.material.depthWrite = false;
        // groundReflector.rotation.x = - Math.PI / 2;
        // groundReflector.visible = false;
        // this.scene.add( groundReflector );

        // camera w orbit controls
        const CAMERA_FOV = 30.0;
        const CAMERA_Z = -2.0;
        this.orbitCam = new THREE.PerspectiveCamera( CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 200.0 );
        this.orbitCam.position.set( 0.0, 1.25, CAMERA_Z );
        // camera controls
        this.controls = new OrbitControls( this.orbitCam, this.renderer.domElement );
        this.controls.screenSpacePanning = true;
        this.controls.target.set( 0.0, 1.25, 0.0 );
        this.controls.update();
        // lookat target
        this.lookAtTarget = new THREE.Object3D();
        this.orbitCam.add( this.lookAtTarget );
        // audio listener
        this.listener = new THREE.AudioListener();
        this.orbitCam.add( this.listener );
        this.scene.add(this.orbitCam);
        this.activeCamera = this.orbitCam;

        // light
        const ambientLight = new THREE.AmbientLight( 0x3f2806 );
        this.scene.add( ambientLight );

        // const ambient = new THREE.AmbientLight( 0x666666 );
        // this.scene.add( ambient );
        const sunLight = new THREE.DirectionalLight( 0xffffff, 1.0 );
        sunLight.position.set( 1000, 2000, -1000 );
        // sunLight.castShadow = true;
        // sunLight.shadow.camera.top = 750;
        // sunLight.shadow.camera.bottom = -750;
        // sunLight.shadow.camera.left = -750;
        // sunLight.shadow.camera.right = 750;
        // sunLight.shadow.camera.near = 750;
        // sunLight.shadow.camera.far = 4000;
        // sunLight.shadow.mapSize.set( 1024, 1024 );
        // sunLight.shadow.bias = -0.0002;
        this.scene.add( sunLight );

        // DEBUG: CAMERA ***********************************
        // test camera + helper
        // this.testCam = new THREE.PerspectiveCamera( CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100.0 );
        // this.testCam.position.set( 0, 1, CAMERA_Z );
        // this.testCamHelper = new THREE.CameraHelper(this.testCam);
        // this.scene.add(this.testCamHelper);
        // this.testmesh = new THREE.Mesh(
        //     new THREE.SphereGeometry( 0.25, 8, 8 ),
        //     new THREE.MeshBasicMaterial( { color: 0xFF0000, wireframe: true } )
        // );
        // this.scene.add( this.testmesh );
        // DEBUG: CAMERA ***********************************

        // animation camera + helper
        this.animationCam = new THREE.PerspectiveCamera( CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100.0 );
        this.animationCam.position.set( 0, 1, CAMERA_Z );
        //this.animationCam.rotation.set(0,Math.PI,0);
        this.animationCam.name = '.camera';
        this.cameraTarget = new THREE.Object3D();
        this.cameraTarget.name = '.target'
        this.animationCam.add(this.cameraTarget);
        //this.animationCam.lookAt(this.cameraTarget.position);
        this.camHelper = new THREE.CameraHelper(this.animationCam);
        this.camHelper.visible = false;
        this.scene.add(this.camHelper);

        // DEBUG: CAMERA ***********************************
        // this.mesh = new THREE.Mesh(
        //     new THREE.SphereGeometry( 0.25, 8, 8 ),
        //     new THREE.MeshBasicMaterial( { color: 0x000000, wireframe: true } )
        // );
        // this.scene.add( this.mesh );
        // DEBUG: CAMERA ***********************************

        // camera animation
        this.cameraMixer = new THREE.AnimationMixer (this.animationCam);
        // DEBUG: CAMERA ***********************************
        // this.testCamMixer = new THREE.AnimationMixer( this.testCam);
        // DEBUG: CAMERA ***********************************
        // this.updateCam = false; // DEBUG

        // RenderPass
        // const renderPass = new RenderPass(this.scene, this.animationCam);
        // const bloomPass = new UnrealBloomPass(new THREE.Vector2(2048,2048), 0, 1, 0.3)
        // this.composer = new EffectComposer( this.renderer );
        // this.composer.addPass(renderPass);
        // this.composer.addPass(bloomPass);

        // helpers
        const gridHelper = new THREE.PolarGridHelper( 5, 10 );
        //const gridHelper = new THREE.GridHelper( 10, 10 );
        this.scene.add( gridHelper );
        const axesHelper = new THREE.AxesHelper( 5 );
        this.scene.add( axesHelper );

        this.clock = new THREE.Clock();
        this.clock.start();
    }

    async init () {
        // load additional async configs here
        // TODO: skybox
    }

    update( delta ) {
        // update
        this.cameraMixer.update( delta );

        this.animationCam.updateProjectionMatrix();
        this.animationCam.up.set(0,1,0);
        this.animationCam.up.applyQuaternion(this.animationCam.quaternion);
        this.animationCam.lookAt(this.cameraTarget.position);

        this.camHelper.update( );

        // DEBUG: CAMERA ***********************************
        // this.mesh.position.set (this.cameraTarget.position.x,
        //     this.cameraTarget.position.y,this.cameraTarget.position.z);
        // DEBUG: CAMERA ***********************************

        // render
        // this.composer.render( delta );
        this.renderer.render( this.scene, this.activeCamera );

    }

}

export { World }