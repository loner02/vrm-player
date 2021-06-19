import {
	BufferAttribute,
	BufferGeometry,
    Object3D,
    MathUtils,
	Quaternion,
	Vector3,
	Euler,
    Matrix4,
    Bone,
    Mesh,
    SphereGeometry,
    MeshBasicMaterial,    
    LineBasicMaterial
} from '/build/three.module.js';

/**
 * VRM models do not have inherent IKs
 * So we add virtual IKs and link to real bones
 * Based on CCDIKSolver
 *      - can not use default CCDIKSolver due to difference in PMX and VRM structures
 *      - no validation checks needed, since we added the IKs by code
 */
 class VRMIkHandler {
    constructor (scene) {
        this.scene = scene;
        this.boneMap = undefined;
        this.IK = [
            {
                target: "RightFootIK",
                effector: "RightFoot",
                iteration: 40,
                links: [
                    {
                        index: "RightLowerLeg", 
                        enabled: false, 
                        rotationMin: new Vector3(-Math.PI,0,0), 
                        rotationMax: new Vector3(0,0,0)
                    },
                    {
                        index: "RightUpperLeg", 
                        enabled:false
                    }
                ], 
                minAngle: -2.0   //radians
            },
            {
                target: "RightToeIK",
                effector: "RightToes",
                iteration: 3,
                links: [
                    {
                        index: "RightFoot", 
                        enabled:false,
                        // rotationMax: new Vector3(Math.PI/3,0,0), 
                        // rotationMin: new Vector3(-Math.PI/3,0,0)
                    }
                ],
                minAngle: -4.0   //radians
            },
            {
                target: "LeftFootIK",
                effector: "LeftFoot",
                iteration: 40,
                links: [
                    {
                        index: "LeftLowerLeg", 
                        enabled: false, 
                        rotationMin: new Vector3(-Math.PI,0,0), 
                        rotationMax: new Vector3(0,0,0)
                    },
                    {
                        index: "LeftUpperLeg", 
                        enabled:false
                    }
                ], 
                minAngle: -2.0   //radians
            },
            {
                target: "LeftToeIK",
                effector: "LeftToes",
                iteration: 3,
                links: [
                    {
                        index: "LeftFoot", 
                        enabled:false,
                        // rotationMax: new Vector3(Math.PI/3,0,0), 
                        // rotationMin: new Vector3(-Math.PI/3,0,0)
                    }
                ],
                minAngle: -4.0   //radians
            }
        ]
    }

    // Add an IK rig to a VRM, based on MMD TDA leg IKs
    addIKRig (vrm, boneMap) {
        this.boneMap = boneMap;

        function calculatePos(from=null, to=null) {
            let current = to;
            const chain = [to];
            while (current.parent && current != from) {
                chain.push(current.parent);
                current = current.parent;
            }
            if (current == null)  return;
            chain.reverse();
            const position = new Vector3(0,0,0);
            for (const node of chain) {
                position.add(node.position);
            }
            return position;
        }

        const root = vrm.scene.children.find(s => s instanceof Bone);

        // add rightLeg IK bones
        const rFootBone = vrm.humanoid.getBoneNode("rightFoot");
        let rFootOffset = calculatePos(root, rFootBone);
        const rFootIKP = new Bone();
        rFootIKP.name = "RightFootIKParent";
        rFootIKP.position.set (rFootOffset.x, 0, rFootOffset.z);
        root.add(rFootIKP);
        // RightFootIK
        const rFootIK = new Bone();
        rFootIK.name = "RightFootIK";
        rFootIK.position.set (0, rFootOffset.y, 0);
        rFootIKP.add(rFootIK);
        const rToeBone = root.getObjectByName(this.boneMap["RightToes"]+"_end", true);  //TODO
        const rToeOffset = calculatePos(root, rToeBone);
        // RightToeIK
        const rToeIK = new Bone();
        rToeIK.name = "RightToeIK";
        rToeIK.position.x = -rFootOffset.x+rToeOffset.x;
        rToeIK.position.y = -rFootOffset.y;
        rToeIK.position.z = -rFootOffset.z+rToeOffset.z;
        // rToeIK.rotation.x = Math.PI/2;
        rFootIK.add(rToeIK);

        // add leftLeg IK bones
        const lFootBone = vrm.humanoid.getBoneNode("leftFoot");
        let lFootOffset = calculatePos(root, lFootBone);
        const lFootIKP = new Bone();
        lFootIKP.name = "LeftFootIKParent";
        lFootIKP.position.set (lFootOffset.x, 0, lFootOffset.z);
        root.add(lFootIKP);
        // LeftFootIK
        const lFootIK = new Bone();
        lFootIK.name = "LeftFootIK";
        lFootIK.position.set (0, lFootOffset.y, 0);
        lFootIKP.add(lFootIK);
        // LeftToeIK
        const lToeBone = root.getObjectByName(this.boneMap["LeftToes"]+"_end", true);  //TODO
        const lToeOffset = calculatePos(root, lToeBone);
        const lToeIK = new Bone();
        lToeIK.name = "LeftToeIK";
        lToeIK.position.x = -lFootOffset.x+lToeOffset.x;
        lToeIK.position.y = -lFootOffset.y;
        lToeIK.position.z = -lFootOffset.z+lToeOffset.z;
        // lToeIK.rotation.x = Math.PI/2;
        lFootIK.add(lToeIK);
    }

    update (vrm) {
        // let q = new Quaternion();
        let targetPos = new Vector3();
        let targetVec = new Vector3();
        let effectorPos = new Vector3();
        let effectorVec = new Vector3();
        let linkPos = new Vector3();
        let invLinkQ = new Quaternion();
        let linkScale = new Vector3();
        let axis = new Vector3();
        let vector = new Vector3();
        const root = vrm.scene.children.find(s => s instanceof Bone);

        for (let ik of this.IK) {
            let effector = root.getObjectByName(this.boneMap[ik.effector], true);
            let target = root.getObjectByName(ik.target, true);
    
            targetPos.setFromMatrixPosition(target.matrixWorld);
            //let links = ik.links;
            for (let j=0; j<ik.iteration; j++) {
                let rotated = false;
                for (let link of ik.links) {
                    if (!link.enabled) break;   // continue
    
                    let bone = root.getObjectByName(this.boneMap[link.index], true);
    
                    bone.matrixWorld.decompose(linkPos, invLinkQ, linkScale);
                    invLinkQ.invert();
                    effectorPos.setFromMatrixPosition(effector.matrixWorld);
                    effectorVec.subVectors(effectorPos, linkPos);
                    effectorVec.applyQuaternion(invLinkQ);
                    effectorVec.normalize();
                    targetVec.subVectors(targetPos, linkPos);
                    targetVec.applyQuaternion(invLinkQ);
                    targetVec.normalize();
    
                    let angle = targetVec.dot(effectorVec);
                    if (angle>1.0) angle = 1.0;
                    else if (angle<-1.0) angle = -1.0;
                    angle = Math.acos(angle);
                    if (angle < 1e-5) continue;
    
                    if (ik.minAngle != null && angle < ik.minAngle) angle = ik.minAngle;
                    if (ik.maxAngle != null && angle > ik.maxAngle) angle = ik.maxAngle;
    
                    axis.crossVectors(effectorVec, targetVec);
                    axis.normalize();
                    invLinkQ.setFromAxisAngle(axis, angle);
                    bone.quaternion.multiply(invLinkQ);
    
                    if (link.limitation !== undefined) {
                        let c = bone.quaternion.w;
                        if (c>1.0) c=1.0;
                        let c2 = Math.sqrt(1 - c*c);
                        bone.quaternion.set(link.limitation.x*c2,
                                            link.limitation.y*c2,
                                            link.limitation.z*c2,
                                            c);
                    }
                    if (link.rotationMin !== undefined) {
                        bone.rotation.setFromVector3(
                            bone.rotation
                                .toVector3(vector)
                                .max(link.rotationMin)
                        );
                    }
                    if (link.rotationMax !== undefined) {
                        bone.rotation.setFromVector3(
                            bone.rotation
                                .toVector3(vector)
                                .min(link.rotationMax)
                        );
                    }
                    bone.updateMatrixWorld(true);
                    rotated = true;
                }
                if (!rotated) break;
            }   
        }
    }

    enableIKs(enable) {
        for (let IK of this.IK) {
            for (let link of IK.links) {
                link.enabled = enable;
            }
        }
    }

    createHelper(vrm) {
        const root = vrm.scene.children.find(s => s instanceof Bone);
        //visualize IK bones
         let lfIKmesh = new Mesh(
            new SphereGeometry( 0.05, 4, 4 ),
            new MeshBasicMaterial( { color: 0xFF0000, wireframe: true } )
        );
        lfIKmesh.name = "LeftFootIK_mesh";
        root.getObjectByName("LeftFootIK", true).add(lfIKmesh);
        let ltIKmesh = new Mesh(
            new SphereGeometry( 0.05, 4, 4 ),
            new MeshBasicMaterial( { color: 0x808000, wireframe: true } )
        );
        ltIKmesh.name = "LeftToeIK_mesh";
        root.getObjectByName("LeftToeIK", true).add(ltIKmesh);
        let rfIKmesh = new Mesh(
            new SphereGeometry( 0.05, 4, 4 ),
            new MeshBasicMaterial( { color: 0x0000FF, wireframe: true } )
        );
        rfIKmesh.name = "RightFootIK_mesh";
        root.getObjectByName("RightFootIK", true).add(rfIKmesh);
        let rtIKmesh = new Mesh(
            new SphereGeometry( 0.05, 4, 4 ),
            new MeshBasicMaterial( { color: 0x008080, wireframe: true } )
        );
        rtIKmesh.name = "RightToeIK_mesh";
        root.getObjectByName("RightToeIK", true).add(rtIKmesh);

        return [
            lfIKmesh,
            ltIKmesh,
            rfIKmesh,
            rtIKmesh
        ]

    }
}

export { VRMIkHandler }