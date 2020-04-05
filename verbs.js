var contractions = [
    ["’","'"],
    ["’","'"],
    ["are not","aren't"],
    ["is not","isn't"],
    ["do not","don't"],
    ["does not","doesn't"],
    ["have not","haven't"],
    ["has not","hasn't"],
    ["was not","wasn't"],
    ["were not","weren't"],
    ["did not","didn't"],
    ["had not","hadn't"],
    ["will not","won't"],
    ["i am ","i'm "],
    ["you are ","you're "],
    ["he is ","he's "],
    ["she is ","she's "],
    ["it is ","it's "],
    ["we are ","we're "],
    ["you are ","you're "],
    ["they are ","they're "],
    ["i	have ","i've "],
    ["you have ","you've "],
    ["we have ","we've "],
    ["you have ","you've "],
    ["they have ","they've "],
    ["i	have got ","i've got "],
    ["you have got ","you've got "],
    ["he has got ","he's got "],
    ["she has got ","she's got "],
    ["it has got ","it's got "],
    ["we have got ","we've got "],
    ["you have got ","you've got "],
    ["they have got ","they've got "],
    ["i will ","i'll "],
    ["you will ","you'll "],
    ["he will ","he'll "],
    ["she will ","she'll "],
    ["it will ","it'll "],
    ["we will ","we'll "],
    ["you will ","you'll "],
    ["they will ","they'll "]
];


var verbs = {

    ToBe: {					
        Affirmative: {				
            Present: {			
                s1PS: "I am",
                s2PS: "You are",
                s3PSm: "He is",
                s3PSf: "She is",
                s3PSi: "It is",
                s1PP: "We are",
                s2PP: "You are",
                s3PP: "They are"
            },			
            PastSimple: {			
                s1PS: "I was",
                s2PS: "You were",
                s3PSm: "He was",
                s3PSf: "She was",
                s3PSi: "It was",
                s1PP: "We were",
                s2PP: "You were",
                s3PP: "They were"
            },			
            PresentContinous: {			
                s1PS: "I am being",
                s2PS: "You are being",
                s3PSm: "He is being",
                s3PSf: "She is being",
                s3PSi: "It is being",
                s1PP: "We are being",
                s2PP: "You are being",
                s3PP: "They are being"
            },			
            Future: {			
                s1PS: "I will be",
                s2PS: "You will be",
                s3PSm: "He will be",
                s3PSf: "She will be",
                s3PSi: "It will be",
                s1PP: "We will be",
                s2PP: "You will be",
                s3PP: "They will be"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I am not",
                s2PS: "You are not",
                s3PSm: "He is not",
                s3PSf: "She is not",
                s3PSi: "It is not",
                s1PP: "We are not",
                s2PP: "You are not",
                s3PP: "They are not"
            },			
            PastSimple: {			
                s1PS: "I was not",
                s2PS: "You were not",
                s3PSm: "He was not",
                s3PSf: "She was not",
                s3PSi: "It was not",
                s1PP: "We were not",
                s2PP: "You were not",
                s3PP: "They were not"
            },			
            PresentContinous: {			
                s1PS: "I am not being",
                s2PS: "You are not being",
                s3PSm: "He is not being",
                s3PSf: "She is not being",
                s3PSi: "It is not being",
                s1PP: "We are not being",
                s2PP: "You are not being",
                s3PP: "They are not being"
            },			
            Future: {			
                s1PS: "I will not be",
                s2PS: "You will not be",
                s3PSm: "He will not be",
                s3PSf: "She will not be",
                s3PSi: "It will not be",
                s1PP: "We will not be",
                s2PP: "You will not be",
                s3PP: "They will not be"
            }			
        },				
        Interrogative: {				
            Present: {			
                s1PS: "Am I?",
                s2PS: "Are you?",
                s3PSm: "Is he?",
                s3PSf: "Is she?",
                s3PSi: "Is it?",
                s1PP: "Are we?",
                s2PP: "Are you?",
                s3PP: "Are they?"
            },			
            PastSimple: {			
                s1PS: "Was I?",
                s2PS: "Were you?",
                s3PSm: "Was he?",
                s3PSf: "Was she?",
                s3PSi: "Was it?",
                s1PP: "Were we?",
                s2PP: "Were you?",
                s3PP: "Were they?"
            },			
            PresentContinous: {			
                s1PS: "Am I being?",
                s2PS: "Are you being?",
                s3PSm: "Is he being?",
                s3PSf: "Is she being?",
                s3PSi: "Is it being?",
                s1PP: "Are we being?",
                s2PP: "Are you being?",
                s3PP: "Are they being?"
            },			
            Future: {			
                s1PS: "will I be?",
                s2PS: "will you be?",
                s3PSm: "will he be?",
                s3PSf: "will she be?",
                s3PSi: "will it be?",
                s1PP: "will we be?",
                s2PP: "will you be?",
                s3PP: "will they be?"
            }			
        }				
    },

    ToHave: {					
        Affirmative: {				
            Present: {			
                s1PS: "I have",
                s2PS: "You have",
                s3PSm: "He has",
                s3PSf: "She has",
                s3PSi: "It has",
                s1PP: "We have",
                s2PP: "You have",
                s3PP: "They have"
            },			
            PastSimple: {			
                s1PS: "I had",
                s2PS: "You had",
                s3PSm: "He had",
                s3PSf: "She had",
                s3PSi: "It had",
                s1PP: "We had",
                s2PP: "You had",
                s3PP: "They had"
            },			
            PresentContinous: {			
                s1PS: "I am having",
                s2PS: "You are having",
                s3PSm: "He is having",
                s3PSf: "She is having",
                s3PSi: "It is having",
                s1PP: "We are having",
                s2PP: "You are having",
                s3PP: "They are having"
            },			
            Future: {			
                s1PS: "I will have",
                s2PS: "You will have",
                s3PSm: "He will have",
                s3PSf: "She will have",
                s3PSi: "It will have",
                s1PP: "We will have",
                s2PP: "You will have",
                s3PP: "They will have"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't have",
                s2PS: "You don't have",
                s3PSm: "He doesn't have",
                s3PSf: "She doesn't have",
                s3PSi: "It doesn't have",
                s1PP: "We don't have",
                s2PP: "You don't have",
                s3PP: "They don't have"
            },			
            PastSimple: {			
                s1PS: "I didn't have",
                s2PS: "You didn't have",
                s3PSm: "He didn't have",
                s3PSf: "She didn't have",
                s3PSi: "It didn't have",
                s1PP: "We didn't have",
                s2PP: "You didn't have",
                s3PP: "They didn't have "
            },			
            PresentContinous: {			
                s1PS: "I am not having",
                s2PS: "You are not having",
                s3PSm: "He is not having",
                s3PSf: "She is not having",
                s3PSi: "It is not having",
                s1PP: "We are not having",
                s2PP: "You are not having",
                s3PP: "They are not having"
            },			
            Future: {			
                s1PS: "I will not have",
                s2PS: "You will not have",
                s3PSm: "He will not have",
                s3PSf: "She will not have",
                s3PSi: "It will not have",
                s1PP: "We will not have",
                s2PP: "You will not have",
                s3PP: "They will not have"
            }			
        },				
        Interrogative: {				
            Present: {			
                s1PS: "Do I have?",
                s2PS: "Do you have?",
                s3PSm: "Does he have?",
                s3PSf: "Does she have?",
                s3PSi: "Does it have?",
                s1PP: "Do we have?",
                s2PP: "Do you have?",
                s3PP: "Do they have?"
            },			
            PastSimple: {			
                s1PS: "Did I have?",
                s2PS: "Did you have?",
                s3PSm: "Did he have?",
                s3PSf: "Did she have?",
                s3PSi: "Did it have?",
                s1PP: "Did we have?",
                s2PP: "Did you have?",
                s3PP: "Did they have?"
            },			
            PresentContinous: {			
                s1PS: "Am I having?",
                s2PS: "Are you having?",
                s3PSm: "Is he having?",
                s3PSf: "Is she having?",
                s3PSi: "Is it having?",
                s1PP: "Are he having?",
                s2PP: "Are he having?",
                s3PP: "Are he having?"
            },			
            Future: {			
                s1PS: "will I have?",
                s2PS: "will you have?",
                s3PSm: "will he have?",
                s3PSf: "will she have?",
                s3PSi: "will it have?",
                s1PP: "will we have?",
                s2PP: "will you have?",
                s3PP: "will they have?"
            }			
        }				
    },

    ToSay: {					
        Affirmative: {				
            Present: {			
                s1PS: "I say",
                s2PS: "You say",
                s3PSm: "He says",
                s3PSf: "She says",
                s3PSi: "It says",
                s1PP: "We say",
                s2PP: "You say",
                s3PP: "They say"
            },			
            PastSimple: {			
                s1PS: "I said",
                s2PS: "You said",
                s3PSm: "He said",
                s3PSf: "She said",
                s3PSi: "It said",
                s1PP: "We said",
                s2PP: "You said",
                s3PP: "They said"
            },			
            PresentContinous: {			
                s1PS: "I am saying",
                s2PS: "You are saying",
                s3PSm: "He is saying",
                s3PSf: "She is saying",
                s3PSi: "It is saying",
                s1PP: "We are saying",
                s2PP: "You are saying",
                s3PP: "They are saying"
            },			
            Future: {			
                s1PS: "I will say",
                s2PS: "You will say",
                s3PSm: "He will say",
                s3PSf: "She will say",
                s3PSi: "It will say",
                s1PP: "We will say",
                s2PP: "You will say",
                s3PP: "They will say"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't say",
                s2PS: "You don't say",
                s3PSm: "He doesn't say",
                s3PSf: "She doesn't say",
                s3PSi: "It doesn't say",
                s1PP: "We don't say",
                s2PP: "You don't say",
                s3PP: "They don't say"
            },			
            PastSimple: {			
                s1PS: "I didn't say",
                s2PS: "You didn't say",
                s3PSm: "He didn't say",
                s3PSf: "She didn't say",
                s3PSi: "It didn't say",
                s1PP: "We didn't say",
                s2PP: "You didn't say",
                s3PP: "They didn't say"
            },			
            PresentContinous: {			
                s1PS: "I am not saying",
                s2PS: "You aren't saying",
                s3PSm: "He isn't saying",
                s3PSf: "She isn't saying",
                s3PSi: "It isn't saying",
                s1PP: "We aren't saying",
                s2PP: "You aren't saying",
                s3PP: "They aren't saying"
            },			
            Future: {			
                s1PS: "I won't say",
                s2PS: "You won't say",
                s3PSm: "He won't say",
                s3PSf: "She won't say",
                s3PSi: "It won't say",
                s1PP: "We won't say",
                s2PP: "You won't say",
                s3PP: "They won't say"
            }			
        },			
        Interrogative: {				
            Present: {			
                s1PS: "Do I say?",
                s2PS: "Do You say?",
                s3PSm: "Does He say?",
                s3PSf: "Does She say?",
                s3PSi: "Does It say?",
                s1PP: "Does We say?",
                s2PP: "Do You say?",
                s3PP: "Do They say?"
            },			
            PastSimple: {			
                s1PS: "Did I say?",
                s2PS: "Did You say?",
                s3PSm: "Did He say?",
                s3PSf: "Did She say?",
                s3PSi: "Did It say?",
                s1PP: "Did We say?",
                s2PP: "Did You say?",
                s3PP: "Did They say?"
            },			
            PresentContinous: {			
                s1PS: "am I saying?",
                s2PS: "are You saying?",
                s3PSm: "is He saying?",
                s3PSf: "is She saying?",
                s3PSi: "is It saying?",
                s1PP: "are We saying?",
                s2PP: "are You saying?",
                s3PP: "are They saying?"
            },			
            Future: {			
                s1PS: "will I say?",
                s2PS: "will You say?",
                s3PSm: "will He say?",
                s3PSf: "will She say?",
                s3PSi: "will It say?",
                s1PP: "will We say?",
                s2PP: "will You say?",
                s3PP: "will They say?"
            }			
        }				
    },			
    ToArrive: {					
        Affirmative: {				
            Present: {			
                s1PS: "I arrive",
                s2PS: "You arrive",
                s3PSm: "He arrives",
                s3PSf: "She arrives",
                s3PSi: "It arrives",
                s1PP: "We arrive",
                s2PP: "You arrive",
                s3PP: "They arrive"
            },			
            PastSimple: {			
                s1PS: "I arrived",
                s2PS: "You arrived",
                s3PSm: "He arrived",
                s3PSf: "She arrived",
                s3PSi: "It arrived",
                s1PP: "We arrived",
                s2PP: "You arrived",
                s3PP: "They arrived"
            },			
            PresentContinous: {			
                s1PS: "I am arriving",
                s2PS: "You are arriving",
                s3PSm: "He is arriving",
                s3PSf: "She is arriving",
                s3PSi: "It is arriving",
                s1PP: "We are arriving",
                s2PP: "You are arriving",
                s3PP: "They are arriving"
            },			
            Future: {			
                s1PS: "I will arrive",
                s2PS: "You will arrive",
                s3PSm: "He will arrive",
                s3PSf: "She will arrive",
                s3PSi: "It will arrive",
                s1PP: "We will arrive",
                s2PP: "You will arrive",
                s3PP: "They will arrive"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't arrive",
                s2PS: "You don't arrive",
                s3PSm: "He doesn't arrive",
                s3PSf: "She doesn't arrive",
                s3PSi: "It doesn't arrive",
                s1PP: "We don't arrive",
                s2PP: "You don't arrive",
                s3PP: "They don't arrive"
            },			
            PastSimple: {			
                s1PS: "I didn't arrive",
                s2PS: "You didn't arrive",
                s3PSm: "He didn't arrive",
                s3PSf: "She didn't arrive",
                s3PSi: "It didn't arrive",
                s1PP: "We didn't arrive",
                s2PP: "You didn't arrive",
                s3PP: "They didn't arrive"
            },			
            PresentContinous: {			
                s1PS: "I am not arriving",
                s2PS: "You aren't arriving",
                s3PSm: "He isn't arriving",
                s3PSf: "She isn't arriving",
                s3PSi: "It isn't arriving",
                s1PP: "We aren't arriving",
                s2PP: "You aren't arriving",
                s3PP: "They aren't arriving"
            },			
            Future: {			
                s1PS: "I won't arrive",
                s2PS: "You won't arrive",
                s3PSm: "He won't arrive",
                s3PSf: "She won't arrive",
                s3PSi: "It won't arrive",
                s1PP: "We won't arrive",
                s2PP: "You won't arrive",
                s3PP: "They won't arrive"
            }			
        },			
        Interrogative: {				
            Present: {			
                s1PS: "Do I arrive?",
                s2PS: "Do You arrive?",
                s3PSm: "Does He arrive?",
                s3PSf: "Does She arrive?",
                s3PSi: "Does It arrive?",
                s1PP: "Does We arrive?",
                s2PP: "Do You arrive?",
                s3PP: "Do They arrive?"
            },			
            PastSimple: {			
                s1PS: "Did I arrive?",
                s2PS: "Did You arrive?",
                s3PSm: "Did He arrive?",
                s3PSf: "Did She arrive?",
                s3PSi: "Did It arrive?",
                s1PP: "Did We arrive?",
                s2PP: "Did You arrive?",
                s3PP: "Did They arrive?"
            },			
            PresentContinous: {			
                s1PS: "am I arriving?",
                s2PS: "are You arriving?",
                s3PSm: "is He arriving?",
                s3PSf: "is She arriving?",
                s3PSi: "is It arriving?",
                s1PP: "are We arriving?",
                s2PP: "are You arriving?",
                s3PP: "are They arriving?"
            },			
            Future: {			
                s1PS: "will I arrive?",
                s2PS: "will You arrive?",
                s3PSm: "will He arrive?",
                s3PSf: "will She arrive?",
                s3PSi: "will It arrive?",
                s1PP: "will We arrive?",
                s2PP: "will You arrive?",
                s3PP: "will They arrive?"
            }			
        }				
    },					
    ToCome: {					
        Affirmative: {				
            Present: {			
                s1PS: "I come",
                s2PS: "You come",
                s3PSm: "He comes",
                s3PSf: "She comes",
                s3PSi: "It comes",
                s1PP: "We come",
                s2PP: "You come",
                s3PP: "They come"
            },			
            PastSimple: {			
                s1PS: "I came",
                s2PS: "You came",
                s3PSm: "He came",
                s3PSf: "She came",
                s3PSi: "It came",
                s1PP: "We came",
                s2PP: "You came",
                s3PP: "They came"
            },			
            PresentContinous: {			
                s1PS: "I am coming",
                s2PS: "You are coming",
                s3PSm: "He is coming",
                s3PSf: "She is coming",
                s3PSi: "It is coming",
                s1PP: "We are coming",
                s2PP: "You are coming",
                s3PP: "They are coming"
            },			
            Future: {			
                s1PS: "I will come",
                s2PS: "You will come",
                s3PSm: "He will come",
                s3PSf: "She will come",
                s3PSi: "It will come",
                s1PP: "We will come",
                s2PP: "You will come",
                s3PP: "They will come"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't come",
                s2PS: "You don't come",
                s3PSm: "He doesn't come",
                s3PSf: "She doesn't come",
                s3PSi: "It doesn't come",
                s1PP: "We don't come",
                s2PP: "You don't come",
                s3PP: "They don't come"
            },			
            PastSimple: {			
                s1PS: "I didn't come",
                s2PS: "You didn't come",
                s3PSm: "He didn't come",
                s3PSf: "She didn't come",
                s3PSi: "It didn't come",
                s1PP: "We didn't come",
                s2PP: "You didn't come",
                s3PP: "They didn't come"
            },			
            PresentContinous: {			
                s1PS: "I am not coming",
                s2PS: "You aren't coming",
                s3PSm: "He isn't coming",
                s3PSf: "She isn't coming",
                s3PSi: "It isn't coming",
                s1PP: "We aren't coming",
                s2PP: "You aren't coming",
                s3PP: "They aren't coming"
            },			
            Future: {			
                s1PS: "I won't come",
                s2PS: "You won't come",
                s3PSm: "He won't come",
                s3PSf: "She won't come",
                s3PSi: "It won't come",
                s1PP: "We won't come",
                s2PP: "You won't come",
                s3PP: "They won't come"
            }			
        },				
        Interrogative: {				
            Present: {			
                s1PS: "Do I come?",
                s2PS: "Do You come?",
                s3PSm: "Does He come?",
                s3PSf: "Does She come?",
                s3PSi: "Does It come?",
                s1PP: "Does We come?",
                s2PP: "Do You come?",
                s3PP: "Do They come?"
            },			
            PastSimple: {			
                s1PS: "Did I come?",
                s2PS: "Did You come?",
                s3PSm: "Did He come?",
                s3PSf: "Did She come?",
                s3PSi: "Did It come?",
                s1PP: "Did We come?",
                s2PP: "Did You come?",
                s3PP: "Did They come?"
            },			
            PresentContinous: {			
                s1PS: "am I coming?",
                s2PS: "are You coming?",
                s3PSm: "is He coming?",
                s3PSf: "is She coming?",
                s3PSi: "is It coming?",
                s1PP: "are We coming?",
                s2PP: "are You coming?",
                s3PP: "are They coming?"
            },			
            Future: {			
                s1PS: "will I come?",
                s2PS: "will You come?",
                s3PSm: "will He come?",
                s3PSf: "will She come?",
                s3PSi: "will It come?",
                s1PP: "will We come?",
                s2PP: "will You come?",
                s3PP: "will They come?"
            }			
        }				
    },					
    ToPlay: {					
        Affirmative: {				
            Present: {			
                s1PS: "I play",
                s2PS: "You play",
                s3PSm: "He plays",
                s3PSf: "She plays",
                s3PSi: "It plays",
                s1PP: "We play",
                s2PP: "You play",
                s3PP: "They play"
            },			
            PastSimple: {			
                s1PS: "I played",
                s2PS: "You played",
                s3PSm: "He played",
                s3PSf: "She played",
                s3PSi: "It played",
                s1PP: "We played",
                s2PP: "You played",
                s3PP: "They played"
            },			
            PresentContinous: {			
                s1PS: "I am playing",
                s2PS: "You are playing",
                s3PSm: "He is playing",
                s3PSf: "She is playing",
                s3PSi: "It is playing",
                s1PP: "We are playing",
                s2PP: "You are playing",
                s3PP: "They are playing"
            },			
            Future: {			
                s1PS: "I will play",
                s2PS: "You will play",
                s3PSm: "He will play",
                s3PSf: "She will play",
                s3PSi: "It will play",
                s1PP: "We will play",
                s2PP: "You will play",
                s3PP: "They will play"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't play",
                s2PS: "You don't play",
                s3PSm: "He doesn't play",
                s3PSf: "She doesn't play",
                s3PSi: "It doesn't play",
                s1PP: "We don't play",
                s2PP: "You don't play",
                s3PP: "They don't play"
            },			
            PastSimple: {			
                s1PS: "I didn't play",
                s2PS: "You didn't play",
                s3PSm: "He didn't play",
                s3PSf: "She didn't play",
                s3PSi: "It didn't play",
                s1PP: "We didn't play",
                s2PP: "You didn't play",
                s3PP: "They didn't play"
            },			
            PresentContinous: {			
                s1PS: "I am not playing",
                s2PS: "You aren't playing",
                s3PSm: "He isn't playing",
                s3PSf: "She isn't playing",
                s3PSi: "It isn't playing",
                s1PP: "We aren't playing",
                s2PP: "You aren't playing",
                s3PP: "They aren't playing"
            },			
            Future: {			
                s1PS: "I won't play",
                s2PS: "You won't play",
                s3PSm: "He won't play",
                s3PSf: "She won't play",
                s3PSi: "It won't play",
                s1PP: "We won't play",
                s2PP: "You won't play",
                s3PP: "They won't play"
            }			
        },				
        Interrogative: {				
            Present: {			
                s1PS: "Do I play?",
                s2PS: "Do You play?",
                s3PSm: "Does He play?",
                s3PSf: "Does She play?",
                s3PSi: "Does It play?",
                s1PP: "Does We play?",
                s2PP: "Do You play?",
                s3PP: "Do They play?"
            },			
            PastSimple: {			
                s1PS: "Did I play?",
                s2PS: "Did You play?",
                s3PSm: "Did He play?",
                s3PSf: "Did She play?",
                s3PSi: "Did It play?",
                s1PP: "Did We play?",
                s2PP: "Did You play?",
                s3PP: "Did They play?"
            },			
            PresentContinous: {			
                s1PS: "am I playing?",
                s2PS: "are You playing?",
                s3PSm: "is He playing?",
                s3PSf: "is She playing?",
                s3PSi: "is It playing?",
                s1PP: "are We playing?",
                s2PP: "are You playing?",
                s3PP: "are They playing?"
            },			
            Future: {			
                s1PS: "will I play?",
                s2PS: "will You play?",
                s3PSm: "will He play?",
                s3PSf: "will She play?",
                s3PSi: "will It play?",
                s1PP: "will We play?",
                s2PP: "will You play?",
                s3PP: "will They play?"
            }			
        }				
    },					

    ToWalk: {					
        Affirmative: {				
            Present: {			
                s1PS: "I walk",
                s2PS: "You walk",
                s3PSm: "He walks",
                s3PSf: "She walks",
                s3PSi: "It walks",
                s1PP: "We walk",
                s2PP: "You walk",
                s3PP: "They walk"
            },			
            PastSimple: {			
                s1PS: "I walked",
                s2PS: "You walked",
                s3PSm: "He walked",
                s3PSf: "She walked",
                s3PSi: "It walked",
                s1PP: "We walked",
                s2PP: "You walked",
                s3PP: "They walked"
            },			
            PresentContinous: {			
                s1PS: "I am walking",
                s2PS: "You are walking",
                s3PSm: "He is walking",
                s3PSf: "She is walking",
                s3PSi: "It is walking",
                s1PP: "We are walking",
                s2PP: "You are walking",
                s3PP: "They are walking"
            },			
            Future: {			
                s1PS: "I will walk",
                s2PS: "You will walk",
                s3PSm: "He will walk",
                s3PSf: "She will walk",
                s3PSi: "It will walk",
                s1PP: "We will walk",
                s2PP: "You will walk",
                s3PP: "They will walk"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't walk",
                s2PS: "You don't walk",
                s3PSm: "He doesn't walk",
                s3PSf: "She doesn't walk",
                s3PSi: "It doesn't walk",
                s1PP: "We don't walk",
                s2PP: "You don't walk",
                s3PP: "They don't walk"
            },			
            PastSimple: {			
                s1PS: "I didn't walk",
                s2PS: "You didn't walk",
                s3PSm: "He didn't walk",
                s3PSf: "She didn't walk",
                s3PSi: "It didn't walk",
                s1PP: "We didn't walk",
                s2PP: "You didn't walk",
                s3PP: "They didn't walk"
            },			
            PresentContinous: {			
                s1PS: "I am not walking",
                s2PS: "You aren't walking",
                s3PSm: "He isn't walking",
                s3PSf: "She isn't walking",
                s3PSi: "It isn't walking",
                s1PP: "We aren't walking",
                s2PP: "You aren't walking",
                s3PP: "They aren't walking"
            },			
            Future: {			
                s1PS: "I won't walk",
                s2PS: "You won't walk",
                s3PSm: "He won't walk",
                s3PSf: "She won't walk",
                s3PSi: "It won't walk",
                s1PP: "We won't walk",
                s2PP: "You won't walk",
                s3PP: "They won't walk"
            }			
        },				
        Interrogative: {				
            Present: {			
                s1PS: "Do I walk?",
                s2PS: "Do You walk?",
                s3PSm: "Does He walk?",
                s3PSf: "Does She walk?",
                s3PSi: "Does It walk?",
                s1PP: "Does We walk?",
                s2PP: "Do You walk?",
                s3PP: "Do They walk?"
            },			
            PastSimple: {			
                s1PS: "Did I walk?",
                s2PS: "Did You walk?",
                s3PSm: "Did He walk?",
                s3PSf: "Did She walk?",
                s3PSi: "Did It walk?",
                s1PP: "Did We walk?",
                s2PP: "Did You walk?",
                s3PP: "Did They walk?"
            },			
            PresentContinous: {			
                s1PS: "am I walking?",
                s2PS: "are You walking?",
                s3PSm: "is He walking?",
                s3PSf: "is She walking?",
                s3PSi: "is It walking?",
                s1PP: "are We walking?",
                s2PP: "are You walking?",
                s3PP: "are They walking?"
            },			
            Future: {			
                s1PS: "will I walk?",
                s2PS: "will You walk?",
                s3PSm: "will He walk?",
                s3PSf: "will She walk?",
                s3PSi: "will It walk?",
                s1PP: "will We walk?",
                s2PP: "will You walk?",
                s3PP: "will They walk?"
            }			
        }				
    },	
    ToRun: {					
        Affirmative: {				
            Present: {			
                s1PS: "I run",
                s2PS: "You run",
                s3PSm: "He runs",
                s3PSf: "She runs",
                s3PSi: "It runs",
                s1PP: "We run",
                s2PP: "You run",
                s3PP: "They run"
            },			
            PastSimple: {			
                s1PS: "I ran",
                s2PS: "You ran",
                s3PSm: "He ran",
                s3PSf: "She ran",
                s3PSi: "It ran",
                s1PP: "We ran",
                s2PP: "You ran",
                s3PP: "They ran"
            },			
            PresentContinous: {			
                s1PS: "I am running",
                s2PS: "You are running",
                s3PSm: "He is running",
                s3PSf: "She is running",
                s3PSi: "It is running",
                s1PP: "We are running",
                s2PP: "You are running",
                s3PP: "They are running"
            },			
            Future: {			
                s1PS: "I will run",
                s2PS: "You will run",
                s3PSm: "He will run",
                s3PSf: "She will run",
                s3PSi: "It will run",
                s1PP: "We will run",
                s2PP: "You will run",
                s3PP: "They will run"
            }			
        },				
        Negative: {				
            Present: {			
                s1PS: "I don't run",
                s2PS: "You don't run",
                s3PSm: "He doesn't run",
                s3PSf: "She doesn't run",
                s3PSi: "It doesn't run",
                s1PP: "We don't run",
                s2PP: "You don't run",
                s3PP: "They don't run"
            },			
            PastSimple: {			
                s1PS: "I didn't run",
                s2PS: "You didn't run",
                s3PSm: "He didn't run",
                s3PSf: "She didn't run",
                s3PSi: "It didn't run",
                s1PP: "We didn't run",
                s2PP: "You didn't run",
                s3PP: "They didn't run"
            },			
            PresentContinous: {			
                s1PS: "I am not running",
                s2PS: "You aren't running",
                s3PSm: "He isn't running",
                s3PSf: "She isn't running",
                s3PSi: "It isn't running",
                s1PP: "We aren't running",
                s2PP: "You aren't running",
                s3PP: "They aren't running"
            },			
            Future: {			
                s1PS: "I won't run",
                s2PS: "You won't run",
                s3PSm: "He won't run",
                s3PSf: "She won't run",
                s3PSi: "It won't run",
                s1PP: "We won't run",
                s2PP: "You won't run",
                s3PP: "They won't run"
            }			
        },				
        Interrogative: {				
            Present: {			
                s1PS: "Do I run?",
                s2PS: "Do You run?",
                s3PSm: "Does He run?",
                s3PSf: "Does She run?",
                s3PSi: "Does It run?",
                s1PP: "Do We run?",
                s2PP: "Do You run?",
                s3PP: "Do They run?"
            },			
            PastSimple: {			
                s1PS: "Did I run?",
                s2PS: "Did You run?",
                s3PSm: "Did He run?",
                s3PSf: "Did She run?",
                s3PSi: "Did It run?",
                s1PP: "Did We run?",
                s2PP: "Did You run?",
                s3PP: "Did They run?"
            },			
            PresentContinous: {			
                s1PS: "Am I running?",
                s2PS: "Are You running?",
                s3PSm: "Is He running?",
                s3PSf: "Is She running?",
                s3PSi: "Is It running?",
                s1PP: "Are We running?",
                s2PP: "Are You running?",
                s3PP: "Are They running?"
            },			
            Future: {			
                s1PS: "will I run?",
                s2PS: "will You run?",
                s3PSm: "will He run?",
                s3PSf: "will She run?",
                s3PSi: "will It run?",
                s1PP: "will We run?",
                s2PP: "will You run?",
                s3PP: "will They run?"
            }			
        }				
    }
}


