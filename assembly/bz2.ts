class BZip2State {
    static readonly MTFA_SIZE: i32 = 4096;
    static readonly MTFL_SIZE: i32 = 16;
    static readonly BZ_MAX_ALPHA_SIZE: i32 = 258;
    static readonly BZ_MAX_CODE_LEN: i32 = 23;
    // static readonly anInt732: i32 = 1; // TODO
    static readonly BZ_N_GROUPS: i32 = 6;
    static readonly BZ_G_SIZE: i32 = 50;
    static readonly BZ_MAX_SELECTORS: i32 = (2 + (900000 / BZip2State.BZ_G_SIZE)); // 18002
    // static readonly anInt735: i32 = 4; // TODO

    static readonly BZ_RUNA: i32 = 0;
    static readonly BZ_RUNB: i32 = 1;

    static tt: Int32Array = new Int32Array(0);

    stream: Int8Array = new Int8Array(0);
    decompressed: Int8Array = new Int8Array(0);

    next_in: i32 = 0;
    avail_in: i32 = 0;
    total_in_lo32: i32 = 0;
    total_in_hi32: i32 = 0;
    next_out: i32 = 0;
    avail_out: i32 = 0;
    total_out_lo32: i32 = 0;
    total_out_hi32: i32 = 0;
    state_out_ch: u8 = 0;
    state_out_len: i32 = 0;
    blockRandomized: bool = false;
    bsBuff: i32 = 0;
    bsLive: i32 = 0;
    blockSize100k: i32 = 0;
    currBlockNo: i32 = 0;
    origPtr: i32 = 0;
    tPos: i32 = 0;
    k0: i32 = 0;
    c_nblock_used: i32 = 0;
    nInUse: i32 = 0;
    save_nblock: i32 = 0;

    readonly unzftab: Int32Array = new Int32Array(256);
    readonly cftab: Int32Array = new Int32Array(257);
    readonly cftabCopy: Int32Array = new Int32Array(257);
    readonly inUse: bool[] = new Array<bool>(256).fill(false);
    readonly inUse16: bool[] = new Array<bool>(16).fill(false);
    readonly seqToUnseq: Uint8Array = new Uint8Array(256);
    readonly mtfa: Uint8Array = new Uint8Array(BZip2State.MTFA_SIZE);
    readonly mtfbase: Int32Array = new Int32Array(256 / BZip2State.MTFL_SIZE);
    readonly selector: Uint8Array = new Uint8Array(BZip2State.BZ_MAX_SELECTORS);
    readonly selectorMtf: Uint8Array = new Uint8Array(BZip2State.BZ_MAX_SELECTORS);
    readonly len: Uint8Array[] = new Array<Uint8Array>(BZip2State.BZ_N_GROUPS).map((): Uint8Array => new Uint8Array(BZip2State.BZ_MAX_ALPHA_SIZE));
    readonly limit: Int32Array[] = new Array<Int32Array>(BZip2State.BZ_N_GROUPS).map((): Int32Array => new Int32Array(BZip2State.BZ_MAX_ALPHA_SIZE));
    readonly base: Int32Array[] = new Array<Int32Array>(BZip2State.BZ_N_GROUPS).map((): Int32Array => new Int32Array(BZip2State.BZ_MAX_ALPHA_SIZE));
    readonly perm: Int32Array[] = new Array<Int32Array>(BZip2State.BZ_N_GROUPS).map((): Int32Array => new Int32Array(BZip2State.BZ_MAX_ALPHA_SIZE));
    readonly minLens: Int32Array = new Int32Array(BZip2State.BZ_N_GROUPS);
}

export function newBzip2State(): BZip2State {
    return new BZip2State();
}

export function read(decompressed: Int8Array, length: i32, stream: Int8Array, avail_in: i32, next_in: i32, state: BZip2State): Int8Array {
    state.stream = stream;
    state.next_in = next_in;
    state.decompressed = decompressed;
    state.next_out = 0;
    state.avail_in = avail_in;
    state.avail_out = length;
    state.bsLive = 0;
    state.bsBuff = 0;
    state.total_in_lo32 = 0;
    state.total_in_hi32 = 0;
    state.total_out_lo32 = 0;
    state.total_out_hi32 = 0;
    state.currBlockNo = 0;
    decompress(state);
    // return length - state.avail_out;
    return state.decompressed;
}

function decompress(state: BZip2State): void {
    let gMinlen: i32 = 0;
    let gLimit: Int32Array | null = null;
    let gBase: Int32Array | null = null;
    let gPerm: Int32Array | null = null;

    state.blockSize100k = 1;
    if (BZip2State.tt.length === 0) {
        BZip2State.tt = new Int32Array(state.blockSize100k * 100_000);
    }

    let reading: bool = true;
    while (reading) {
        let uc: u8 = getByte(state);
        if (uc === 0x17) { // 23
            return;
        }

        // uc checks originally broke the loop and returned an error in libbzip2
        uc = getByte(state);
        uc = getByte(state);
        uc = getByte(state);
        uc = getByte(state);
        uc = getByte(state);

        state.currBlockNo++;

        uc = getByte(state);
        uc = getByte(state);
        uc = getByte(state);
        uc = getByte(state);

        uc = getBit(state);
        state.blockRandomized = uc !== 0;
        if (state.blockRandomized) {
            console.log('PANIC! RANDOMISED BLOCK!');
        }

        state.origPtr = 0;
        uc = getByte(state);
        state.origPtr = state.origPtr << 8 | uc & 0xFF;
        uc = getByte(state);
        state.origPtr = state.origPtr << 8 | uc & 0xFF;
        uc = getByte(state);
        state.origPtr = state.origPtr << 8 | uc & 0xFF;

        // Receive the mapping table
        for (let i: i32 = 0; i < 16; i++) {
            uc = getBit(state);
            state.inUse16[i] = uc == 1;
        }

        for (let i: i32 = 0; i < 256; i++) {
            state.inUse[i] = false;
        }

        for (let i: i32 = 0; i < 16; i++) {
            if (state.inUse16[i]) {
                for (let j: i32 = 0; j < 16; j++) {
                    uc = getBit(state);
                    if (uc == 1) {
                        state.inUse[i * 16 + j] = true;
                    }
                }
            }
        }
        makeMaps(state);
        const alphaSize: i32 = state.nInUse + 2;

        const nGroups: i32 = getBits(3, state);
        const nSelectors: i32 = getBits(15, state);
        for (let i: i32 = 0; i < nSelectors; i++) {
            let j: i32 = 0;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                uc = getBit(state);
                if (uc == 0) {
                    break;
                }
                j++;
            }

            state.selectorMtf[i] = <u8>j;
        }

        // Undo the MTF values for the selectors
        const pos: Uint8Array = new Uint8Array(BZip2State.BZ_N_GROUPS);
        for (let v: i32 = 0; v < nGroups; v++) {
            pos[v] = <u8>v;
        }

        for (let i: i32 = 0; i < nSelectors; i++) {
            let v: u8 = state.selectorMtf[i];
            const tmp: u8 = pos[v];
            while (v > 0) {
                pos[v] = pos[v - 1];
                v--;
            }
            pos[0] = tmp;
            state.selector[i] = tmp;
        }

        // Now the coding tables
        for (let t: i32 = 0; t < nGroups; t++) {
            let curr: i32 = getBits(5, state);

            for (let i: i32 = 0; i < alphaSize; i++) {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    uc = getBit(state);
                    if (uc == 0) {
                        break;
                    }

                    uc = getBit(state);
                    if (uc == 0) {
                        curr++;
                    } else {
                        curr--;
                    }
                }

                state.len[t][i] = <u8>curr;
            }
        }

        // Create the Huffman decoding tables
        for (let t: i32 = 0; t < nGroups; t++) {
            let minLen: u8 = 32;
            let maxLen: u8 = 0;

            for (let i: i32 = 0; i < alphaSize; i++) {
                if (state.len[t][i] > maxLen) {
                    maxLen = state.len[t][i];
                }

                if (state.len[t][i] < minLen) {
                    minLen = state.len[t][i];
                }
            }

            createDecodeTables(state.limit[t], state.base[t], state.perm[t], state.len[t], minLen, maxLen, alphaSize);
            state.minLens[t] = minLen;
        }

        // Now the MTF values
        const EOB: i32 = state.nInUse + 1;
        // const nblockMAX: i32 = state.blockSize100k * 100000;
        let groupNo: i32 = -1;
        let groupPos: u8 = 0;

        for (let i: i32 = 0; i <= 255; i++) {
            state.unzftab[i] = 0;
        }

        // MTF init
        let kk: i32 = BZip2State.MTFA_SIZE - 1;
        for (let ii: i32 = 256 / BZip2State.MTFL_SIZE - 1; ii >= 0; ii--) {
            for (let jj: i32 = BZip2State.MTFL_SIZE - 1; jj >= 0; jj--) {
                state.mtfa[kk] = <u8>(ii * BZip2State.MTFL_SIZE + jj);
                kk--;
            }

            state.mtfbase[ii] = kk + 1;
        }
        // end MTF init

        let nblock: i32 = 0;

        // macro: GET_MTF_VAL
        let gSel: u8;
        if (groupPos == 0) {
            groupNo++;
            groupPos = 50;
            gSel = state.selector[groupNo];
            gMinlen = state.minLens[gSel];
            gLimit = state.limit[gSel];
            gPerm = state.perm[gSel];
            gBase = state.base[gSel];
        }

        let gPos: i32 = groupPos - 1;
        let zn: i32 = gMinlen;
        let zvec: i32;
        let zj: u8;
        for (zvec = getBits(gMinlen, state); zvec > gLimit![zn]; zvec = zvec << 1 | zj) {
            zn++;
            zj = getBit(state);
        }

        let nextSym: i32 = gPerm![zvec - gBase![zn]];
        while (nextSym != EOB) {
            if (nextSym == BZip2State.BZ_RUNA || nextSym == BZip2State.BZ_RUNB) {
                let es: i32 = -1;
                let N: i32 = 1;

                do {
                    if (nextSym == BZip2State.BZ_RUNA) {
                        es += N;
                    } else if (nextSym == BZip2State.BZ_RUNB) {
                        es += N * 2;
                    }

                    N *= 2;
                    if (gPos == 0) {
                        groupNo++;
                        gPos = 50;
                        gSel = state.selector[groupNo];
                        gMinlen = state.minLens[gSel];
                        gLimit = state.limit[gSel];
                        gPerm = state.perm[gSel];
                        gBase = state.base[gSel];
                    }

                    gPos--;
                    zn = gMinlen;
                    for (zvec = getBits(gMinlen, state); zvec > gLimit![zn]; zvec = zvec << 1 | zj) {
                        zn++;
                        zj = getBit(state);
                    }

                    nextSym = gPerm![zvec - gBase![zn]];
                } while (nextSym == BZip2State.BZ_RUNA || nextSym == BZip2State.BZ_RUNB);

                es++;
                uc = state.seqToUnseq[state.mtfa[state.mtfbase[0]] & 0xFF];
                state.unzftab[uc & 0xFF] += es;

                while (es > 0) {
                    BZip2State.tt[nblock] = uc & 0xFF;
                    nblock++;
                    es--;
                }
            } else {
                // uc = MTF ( nextSym-1 )
                let nn: i32 = nextSym - 1;
                let pp: i32;

                if (nn < BZip2State.MTFL_SIZE) {
                    // avoid general-case expense
                    pp = state.mtfbase[0];
                    uc = state.mtfa[pp + nn];

                    while (nn > 3) {
                        const z: i32 = pp + nn;
                        state.mtfa[z] = state.mtfa[z - 1];
                        state.mtfa[z - 1] = state.mtfa[z - 2];
                        state.mtfa[z - 2] = state.mtfa[z - 3];
                        state.mtfa[z - 3] = state.mtfa[z - 4];
                        nn -= 4;
                    }

                    while (nn > 0) {
                        state.mtfa[pp + nn] = state.mtfa[pp + nn - 1];
                        nn--;
                    }

                    state.mtfa[pp] = uc;
                } else {
                    // general case
                    let lno: i32 = nn / BZip2State.MTFL_SIZE;
                    const off: i32 = nn % BZip2State.MTFL_SIZE;

                    pp = state.mtfbase[lno] + off;
                    uc = state.mtfa[pp];

                    while (pp > state.mtfbase[lno]) {
                        state.mtfa[pp] = state.mtfa[pp - 1];
                        pp--;
                    }

                    state.mtfbase[lno]++;

                    while (lno > 0) {
                        state.mtfbase[lno]--;
                        state.mtfa[state.mtfbase[lno]] = state.mtfa[state.mtfbase[lno - 1] + 16 - 1];
                        lno--;
                    }

                    state.mtfbase[0]--;
                    state.mtfa[state.mtfbase[0]] = uc;

                    if (state.mtfbase[0] == 0) {
                        kk = BZip2State.MTFA_SIZE - 1;
                        for (let ii: i32 = 256 / BZip2State.MTFL_SIZE - 1; ii >= 0; ii--) {
                            for (let jj: i32 = BZip2State.MTFL_SIZE - 1; jj >= 0; jj--) {
                                state.mtfa[kk] = state.mtfa[state.mtfbase[ii] + jj];
                                kk--;
                            }

                            state.mtfbase[ii] = kk + 1;
                        }
                    }
                }
                // end uc = MTF ( nextSym-1 )

                state.unzftab[state.seqToUnseq[uc & 0xFF] & 0xFF]++;
                BZip2State.tt[nblock] = state.seqToUnseq[uc & 0xFF] & 0xFF;
                nblock++;

                // macro: GET_MTF_VAL
                if (gPos == 0) {
                    groupNo++;
                    gPos = 50;
                    gSel = state.selector[groupNo];
                    gMinlen = state.minLens[gSel];
                    gLimit = state.limit[gSel];
                    gPerm = state.perm[gSel];
                    gBase = state.base[gSel];
                }

                gPos--;
                zn = gMinlen;
                for (zvec = getBits(gMinlen, state); zvec > gLimit![zn]; zvec = zvec << 1 | zj) {
                    zn++;
                    zj = getBit(state);
                }
                nextSym = gPerm![zvec - gBase![zn]];
            }
        }

        // Set up cftab to facilitate generation of T^(-1)

        // Actually generate cftab
        state.cftab[0] = 0;

        for (let i: i32 = 1; i <= 256; i++) {
            state.cftab[i] = state.unzftab[i - 1];
        }

        for (let i: i32 = 1; i <= 256; i++) {
            state.cftab[i] += state.cftab[i - 1];
        }

        state.state_out_len = 0;
        state.state_out_ch = 0;

        // compute the T^(-1) vector
        for (let i: i32 = 0; i < nblock; i++) {
            uc = <u8>(BZip2State.tt[i] & 0xFF);
            BZip2State.tt[state.cftab[uc & 0xFF]] |= i << 8;
            state.cftab[uc & 0xFF]++;
        }

        state.tPos = BZip2State.tt[state.origPtr] >> 8;
        state.c_nblock_used = 0;

        // macro: BZ_GET_FAST
        state.tPos = BZip2State.tt[state.tPos];
        state.k0 = <u8>(state.tPos & 0xFF);
        state.tPos >>= 8;
        state.c_nblock_used++;

        state.save_nblock = nblock;
        finish(state);
        reading = state.c_nblock_used == state.save_nblock + 1 && state.state_out_len == 0;
    }
}

function getBits(n: i32, state: BZip2State): i32 {
    while (state.bsLive < n) {
        state.bsBuff = state.bsBuff << 8 | (state.stream[state.next_in] & 0xFF);
        state.bsLive += 8;
        state.next_in++;
        state.avail_in--;
        state.total_in_lo32++;
        if (state.total_in_lo32 == 0) {
            state.total_in_hi32++;
        }
    }

    const value: i32 = state.bsBuff >> state.bsLive - n & (1 << n) - 1;
    state.bsLive -= n;
    return value;
}

function getBit(state: BZip2State): u8 {
    return <u8>getBits(1, state);
}

function getByte(state: BZip2State): u8 {
    return <u8>getBits(8, state);
}

function makeMaps(state: BZip2State): void {
    state.nInUse = 0;

    for (let i: i32 = 0; i < 256; i++) {
        if (state.inUse[i]) {
            state.seqToUnseq[state.nInUse] = <u8>i;
            state.nInUse++;
        }
    }
}

function createDecodeTables(limit: Int32Array, base: Int32Array, perm: Int32Array, length: Uint8Array, minLen: i32, maxLen: i32, alphaSize: i32): void {
    let pp: i32 = 0;

    for (let i: i32 = minLen; i <= maxLen; i++) {
        for (let j: i32 = 0; j < alphaSize; j++) {
            if (length[j] == i) {
                perm[pp] = j;
                pp++;
            }
        }
    }

    for (let i: i32 = 0; i < BZip2State.BZ_MAX_CODE_LEN; i++) {
        base[i] = 0;
    }

    for (let i: i32 = 0; i < alphaSize; i++) {
        base[length[i] + 1]++;
    }

    for (let i: i32 = 1; i < BZip2State.BZ_MAX_CODE_LEN; i++) {
        base[i] += base[i - 1];
    }

    for (let i: i32 = 0; i < BZip2State.BZ_MAX_CODE_LEN; i++) {
        limit[i] = 0;
    }

    let vec: i32 = 0;
    for (let i: i32 = minLen; i <= maxLen; i++) {
        vec += base[i + 1] - base[i];
        limit[i] = vec - 1;
        vec <<= 1;
    }

    for (let i: i32 = minLen + 1; i <= maxLen; i++) {
        base[i] = (limit[i - 1] + 1 << 1) - base[i];
    }
}

// unRLE_obuf_to_output_FAST
function finish(state: BZip2State): void {
    let c_state_out_ch: u8 = <u8>state.state_out_ch;
    let c_state_out_len: i32 = state.state_out_len;
    let c_nblock_used: i32 = state.c_nblock_used;
    let c_k0: i32 = state.k0;
    const c_tt: Int32Array = BZip2State.tt;
    let c_tPos: i32 = state.tPos;
    const cs_decompressed: Int8Array = state.decompressed;
    let cs_next_out: i32 = state.next_out;
    let cs_avail_out: i32 = state.avail_out;
    const avail_out_INIT: i32 = cs_avail_out;
    const s_save_nblockPP: i32 = state.save_nblock + 1;

    let outer: bool = true;
    do {
        if (c_state_out_len > 0) {
            let inner: bool = true;
            do {
                if (cs_avail_out == 0) {
                    outer = false;
                    inner = false;
                } else {
                    cs_decompressed[cs_next_out] = c_state_out_ch;
                    if (c_state_out_len == 1) {
                        cs_next_out++;
                        cs_avail_out--;
                        inner = false;
                    } else {
                        c_state_out_len--;
                        cs_next_out++;
                        cs_avail_out--;
                    }
                }
            } while (inner);
        }

        let next: bool = true;
        let k1: u8;
        while (next) {
            next = false;
            if (c_nblock_used == s_save_nblockPP) {
                c_state_out_len = 0;
                outer = false;
            } else {

                // macro: BZ_GET_FAST_C
                c_state_out_ch = <u8>c_k0;
                c_tPos = c_tt[c_tPos];
                k1 = <u8>(c_tPos & 0xFF);
                c_tPos >>= 0x8;
                c_nblock_used++;

                if (k1 != c_k0) {
                    c_k0 = k1;
                    if (cs_avail_out == 0) {
                        c_state_out_len = 1;
                        outer = false;
                    } else {
                        cs_decompressed[cs_next_out] = c_state_out_ch;
                        cs_next_out++;
                        cs_avail_out--;
                        next = true;
                    }
                } else if (c_nblock_used == s_save_nblockPP) {
                    if (cs_avail_out == 0) {
                        c_state_out_len = 1;
                        outer = false;
                    } else {
                        cs_decompressed[cs_next_out] = c_state_out_ch;
                        cs_next_out++;
                        cs_avail_out--;
                        next = true;
                    }
                }
            }
        }

        if (outer) {
            // macro: BZ_GET_FAST_C
            c_state_out_len = 2;
            c_tPos = c_tt[c_tPos];
            k1 = <u8>(c_tPos & 0xFF);
            c_tPos >>= 0x8;
            c_nblock_used++;

            if (c_nblock_used != s_save_nblockPP) {
                if (k1 == c_k0) {
                    // macro: BZ_GET_FAST_C
                    c_state_out_len = 3;
                    c_tPos = c_tt[c_tPos];
                    k1 = <u8>(c_tPos & 0xFF);
                    c_tPos >>= 0x8;
                    c_nblock_used++;

                    if (c_nblock_used != s_save_nblockPP) {
                        if (k1 == c_k0) {
                            // macro: BZ_GET_FAST_C
                            c_tPos = c_tt[c_tPos];
                            k1 = <u8>(c_tPos & 0xFF);
                            c_tPos >>= 0x8;
                            c_nblock_used++;

                            // macro: BZ_GET_FAST_C
                            c_state_out_len = (k1 & 0xFF) + 4;
                            c_tPos = c_tt[c_tPos];
                            c_k0 = <u8>(c_tPos & 0xFF);
                            c_tPos >>= 0x8;
                            c_nblock_used++;
                        } else {
                            c_k0 = k1;
                        }
                    }
                } else {
                    c_k0 = k1;
                }
            }
        }
    } while (outer);

    const total_out_lo32_old: i32 = state.total_out_lo32;
    state.total_out_lo32 += avail_out_INIT - cs_avail_out;
    if (state.total_out_lo32 < total_out_lo32_old) {
        state.total_out_hi32++;
    }

    // save
    state.state_out_ch = c_state_out_ch;
    state.state_out_len = c_state_out_len;
    state.c_nblock_used = c_nblock_used;
    state.k0 = c_k0;
    BZip2State.tt = c_tt;
    state.tPos = c_tPos;
    // s.decompressed = cs_decompressed;
    state.next_out = cs_next_out;
    state.avail_out = cs_avail_out;
    // end save
}

