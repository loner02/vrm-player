

const State = {
    IN: "IN",       // morph is transitioning in
    OFF: "OFF",     // morph is inactive
    ON: "ON",       // morph is active
    OUT: "OUT"      // morph is transitioning out
}
const TRANSITION_TIME = 0.1;    // fade-in/out time in sec

class MorphPlayer {

    constructor (vrm, id) {
        this.state = State.OFF;         // default STATE
        this.duration = -1;             // default ON time
                                        // if duration >= 0, automatically transition
                                        //      to OFF after set duration
        this.name = id;
        this.vrm = vrm;
        
        // execution flags/vars
        this._start = false;
        this._time = 0;
        this._target = 0;
        this._morph = 0;
        this._currState = State.OFF;
    }

    start( value, duration=-1 ) {
        this._start = true;
        this._time = 0;
        this._target = value;
        this.duration = duration;
    }

    end() {
        this._start = false;
        this._time = 0;
        this._target = 0;
    }

    update(elapsed) {

        // Morph computation utilities
        const lerp = (target, src, amt) => {return amt * target + (1 - amt) * src};
        const ease = (x) => {return x * x * (3 - 2 * x)};

        if (this.state != this._currState) {
            this._currState = this.state;
            //console.log(`[${this.name}]: ${this.state}`);
        }
        switch (this.state) {
            case State.IN:
                this._time += elapsed;
                if (this._time <= TRANSITION_TIME) {
                    // compute morph blend value
                    let normalizedTime = this._time / TRANSITION_TIME;
                    this._morph = Math.min(1, lerp(this._target, this._morph, ease(normalizedTime)));
                    this.vrm.blendShapeProxy.setValue (this.name, this._morph);
                    //console.log(this._morph);
                }
                else {
                    this._morph = 1;
                    this.vrm.blendShapeProxy.setValue (this.name, this._morph);
                    this.state = State.ON;
                    this._time = 0;
                }
                break;
            case State.ON:
                if (this.duration >= 0) {
                    this.duration = Math.max (0, this.duration - elapsed);
                    if (this.duration == 0) {
                        this.state = State.OUT;
                        this._start = false;
                        this._time = 0;
                        this._target = 0;
                    }
                }
                else {
                    if (this._start == false) 
                        this.state = State.OUT;
                }
                break;
            case State.OUT:
                this._time += elapsed;
                if (this._time <= TRANSITION_TIME) {
                    // compute morph blend value
                    let normalizedTime = this._time / TRANSITION_TIME;
                    this._morph = Math.max(0, lerp(this._target, this._morph, normalizedTime));
                    this.vrm.blendShapeProxy.setValue (this.name, this._morph);
                    //console.log(this._morph);
                }
                else {
                    this._morph = 0;
                    this.vrm.blendShapeProxy.setValue (this.name, this._morph);
                    this.state = State.OFF;
                    this._time = 0;
                }
                break
            case State.OFF:
            default:
                if (this._start == true)
                    this.state = State.IN;
                break;
        }
    }
}

export { MorphPlayer }