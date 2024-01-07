import Jagfile from '../io/Jagfile';
import Packet from '../io/Packet';
import {ConfigType} from './ConfigType';

export default class FloType extends ConfigType {
    static count: number = 0;
    static instances: FloType[] = [];

    static unpack = (config: Jagfile): void => {
        const dat = new Packet(config.read('flo.dat'));
        this.count = dat.g2;
        for (let i = 0; i < this.count; i++) {
            this.instances[i] = new FloType(i);
            this.instances[i].decodeType(dat);
        }
    };

    static get = (id: number): FloType => FloType.instances[id];

    // ----

    rgb: number = 0;
    texture: number = -1;
    opcode3: boolean = false;
    occludes: boolean = true;
    name: string | null = null;

    decode = (code: number, dat: Packet): void => {
        if (code === 1) {
            this.rgb = dat.g3;
        } else if (code === 2) {
            this.texture = dat.g1;
        } else if (code === 3) {
            this.opcode3 = true;
        } else if (code === 5) {
            this.occludes = false;
        } else if (code === 6) {
            this.name = dat.gjstr;
        } else {
            console.log('Error unrecognised config code: ', code);
        }
    };
}