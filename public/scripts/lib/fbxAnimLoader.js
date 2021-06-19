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
import { FBXLoader } from '/jsm/loaders/FBXLoader'

class FBXAnimLoader {
    constructor () {
        this.loader = new FBXLoader();
        this.boneMap = new Map();
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
        this.loader.load (url, (fbx) => {
			try {
                //console.log (fbx);
				onLoad( this.parse( fbx ) );
			} catch ( e ) {
				if ( onError ) {
					onError( e );
				} else {
					console.error( e );
				}
				this.manager.itemError( url );
			}
		}, onProgress, onError );
    }

	async parse ( fbx ) {
		// Detect boneMap to use; currently only support Mixamo FBX
		this.detectMap( fbx );

        // update bone names
        // update tracks
        let skeleton = new Skeleton(fbx.children);
        this.updateBoneMaps (skeleton.bones); 
        this.updateClips (fbx.animations);

		return {
			skeleton: skeleton,
			clip: fbx.animations[0]
		};
	}

    updateBoneMaps(bones) {
        for (let bone of bones) {
            bone.name = (this.mapActive && this.mapActive.bones[bone.name])  ? this.mapActive.bones[bone.name] : bone.name;
            if (bone.children.length > 0)
                this.updateBoneMaps(bone.children);
        }
    }

    updateClips (clips) {
        for (let clip of clips) {
            for (let track of clip.tracks) {
                let name = track.name.split('.');
                track.name = (this.mapActive && this.mapActive.bones[name[0]])  
                        ? '.'+this.mapActive.bones[name[0]]+'.'+name[1] 
                        : '.'+track.name;
                if (name[1] == 'position') {
                    for (let i=0; i<track.values.length; i++) {
                        track.values[i]= this.mapActive.adjust[i%3] * track.values[i];
                    }
                }
                else if (name[1] == 'quaternion') {
                    for (let i=0; i<track.values.length; i=i+4) {
                        let q = new Quaternion(track.values[i], track.values[i+1], track.values[i+2], track.values[i+3]);
                        q = this.adjustQ(q);
                        track.values[i]= q.x;
                        track.values[i+1] = q.y;
                        track.values[i+2] = q.z;
                        track.values[i+3] = q.w;
                    }

                }
            }
        }    
    }

    detectMap ( fbx ) {
		this.mapActive = null;
        // crude checking
        if (fbx.animations[0].name == 'mixamo.com') {
            this.mapActive = this.boneMap.get("Mixamo");
        }
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

export { FBXAnimLoader }