function transliterateToTelugu(text) {

    const map = {
        a: "అ",
        aa: "ఆ",
        i: "ఇ",
        ee: "ఈ",
        u: "ఉ",
        oo: "ఊ",
        e: "ఎ",
        o: "ఒ",

        ka: "క",
        ga: "గ",
        cha: "చ",
        ja: "జ",
        ta: "ట",
        da: "డ",
        na: "న",
        pa: "ప",
        ba: "బ",
        ma: "మ",
        ya: "య",
        ra: "ర",
        la: "ల",
        va: "వ",
        sa: "స",
        ha: "హ"
    };

    let result = text;

    Object.keys(map)
        .sort((a,b) => b.length-a.length)
        .forEach(key => {
            result = result.replaceAll(
                new RegExp(key, 'gi'),
                map[key]
            );
        });

    return result;
}

module.exports = transliterateToTelugu;