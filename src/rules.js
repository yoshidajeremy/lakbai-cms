export const budgetOptions = [
    { label: "₱6,600", value: "P6600" },
    { label: "₱5,000", value: "P5000" },
    { label: "₱5,500", value: "P5500" },
    { label: "₱8,000", value: "P8000" },
    { label: "₱10,000", value: "P10000" }
];
export const breakdown = {
    P6600 : ["Transportation: ~₱2,000 (air and sea travel are not included)", "Foods: ~₱600", "Souvenirs: ~₱1,000", "Miscellaneous: ~₱1,000 (entrance fees, guide fees, etc.)"], 
    P5000 : ["Transportation: ~₱2,000 (air and sea travel are not included)", "Foods: ~₱800", "Souvenirs: ~₱1,000", "Miscellaneous: ~₱1,200 (entrance fees, guide fees, etc.)"],
    P5500 : ["Transportation: ~₱2,000 (air and sea travel are not included)", "Foods: ~₱700", "Souvenirs: ~₱1,200", "Miscellaneous: ~₱1,600 (entrance fees, guide fees, etc.)"],
    P8000 : ["Transportation: ~₱3,000 (air and sea travel are not included)", "Foods: ~₱3,000", "Souvenirs: ~₱1,000", "Miscellaneous: ~₱1,000 (entrance fees, guide fees, etc.)"],
    P10000 : ["Transportation: ~₱3,000 (air and sea travel are not included)", "Foods: ~₱4,000", "Souvenirs: ~₱1,500", "Miscellaneous: ~₱1,500 (entrance fees, guide fees, etc.)"]
}

export const category = {
    beach: [
        'Swimwear (multiple sets)',
        'Rash guard / quick-dry shirt',
        'Flip-flops or aqua shoes',
        'Beach towel or sarong',
        'Snorkeling gear (optional if not renting)',
        'Waterproof dry bag (phone, wallet, camera)',
        'Reef-safe sunscreen & after-sun (aloe vera)',
        'Sunglasses & hat/cap',
        'Portable hammock or mat',
        'Light cover-up / beach dress / shorts'
    ],
    beaches: [
        'Swimwear (multiple sets)',
        'Rash guard / quick-dry shirt',
        'Flip-flops or aqua shoes',
        'Beach towel or sarong',
        'Snorkeling gear (optional if not renting)',
        'Waterproof dry bag (phone, wallet, camera)',
        'Reef-safe sunscreen & after-sun (aloe vera)',
        'Sunglasses & hat/cap',
        'Portable hammock or mat',
        'Light cover-up / beach dress / shorts'
    ],
    caves: [
        'Headlamp / reliable flashlight (extra batteries)',
        'Helmet (if required / available)',
        'Sturdy non-slip footwear',
        'Gloves for grip (optional)',
        'Quick-dry clothes (avoid cotton)',
        'Small waterproof pouch (valuables)',
        'Insect repellent',
        'Drinking water & light snacks'
    ],
    cultural: [
        'Modest clothing (long pants/skirt, sleeves)',
        'Light scarf / shawl',
        'Comfortable walking sandals / shoes',
        'Reusable shopping bag',
        'Notebook / pen',
        'Small tokens / gifts (optional)',
        'Camera / phone (extra storage)',
        'Offline translation app'
    ],
    historical: [
        'Lightweight modest clothing',
        'Comfortable walking shoes',
        'Sun protection (cap / umbrella / sunscreen)',
        'Camera / phone (wide-angle if possible)',
        'Guidebook / printed notes',
        'Reusable water bottle'
    ],
    islands: [
        'Dry bag (boat rides splashy)',
        'Waterproof phone case',
        'Swimwear & rash guard',
        'Snorkeling gear (or rent on site)',
        'Powerbank',
        'Insect repellent (sandflies / mosquitoes)',
        'Cash (small bills, fees/vendors)',
        'Refillable water bottle'
    ],
    landmarks: [
        'Comfortable casual wear',
        'Walking shoes / sandals',
        'Hat / cap',
        'Camera / phone',
        'Small umbrella (sudden rain)',
        'Notebook / pen'
    ],
    mountains: [
        'Trekking shoes / trail sandals',
        'Trekking pole (optional)',
        'Quick-dry clothes + extra layer',
        'Cap / hat & sunglasses',
        'Headlamp (sunrise hikes)',
        'Small backpack (10–20L)',
        'Snacks (trail mix, energy bars)',
        'Drinking water (bottles / bladder)',
        'Raincoat / poncho',
        'First aid kit + blister patches'
    ],
    museums: [
        'Smart casual clothing',
        'Lightweight jacket (strong AC)',
        'Notebook / sketchpad + pen',
        'Smartphone / camera (if allowed)',
        'ID card (entry requirement sometimes)',
        'Reusable water bottle (may stay outside)'
    ],
    parks: [
        'Sturdy shoes (trek/hike trails)',
        'Hat, sunglasses, sunscreen',
        'Insect repellent',
        'Light raincoat / poncho',
        'Binoculars (birdwatching)',
        'Refillable water bottle & snacks',
        'Camera with zoom lens',
        'Picnic mat',
        'Trash bags (Leave No Trace)'
    ],
    tourist: [
        'Casual breathable clothing',
        'Comfortable walking shoes',
        'Small backpack / daypack',
        'Sunglasses, hat, sunscreen',
        'Reusable water bottle',
        'Portable fan / handkerchief',
        'Powerbank & cables',
        'Local SIM / pocket WiFi',
        'Copies of ID & travel documents',
        'Cash (small bills) + ATM/credit card'
    ],
    waterfalls: [
        'Quick-dry clothing (avoid cotton)',
        'Water shoes / sturdy sandals',
        'Waterproof dry bag (valuables)',
        'Swimwear & towel',
        'Insect repellent',
        'Sunscreen & hat',
        'Snacks & drinking water'
    ]
};

export const action_types = {
    Suspend_Account: { // temporary suspension on account based on violation type if 3 posts/contents are reported (based the suspension duration on each violation type)
        Inappropriate_Content: [
            "Your account is suspended for 1 day due to posting content that violates our community guidelines. Please review the guidelines to avoid further violations."
        ],
        Spam_Promotional_Content: [
            "Your account is suspended for 3 days due to posting content that has been identified as spam or promotional material, which is against our community guidelines. Please refrain from posting such content."
        ],
        Harassment_Bullying: [
            "Your account is suspended for 3 days due to posting content that has been identified as harassment or bullying, which is a violation of our community guidelines. Please ensure respectful interactions with other users."
        ],
        Fake_Misleading_Content: [
            "Your account is suspended for 7 days due to posting content that has been flagged as fake or misleading information, which goes against our community guidelines. Please verify your sources before sharing."
        ],
        Hate_Speech: [
            "Your account is suspended for 7 days due to posting content that has been reported for hate speech, which is strictly prohibited by our community guidelines. Please adhere to respectful communication."
        ],
        Violence_Threats: [
            "Your account is suspended for 14 days due to posting content that contains threats of violence, which violates our community guidelines. Such behavior is not tolerated on our platform."
        ],
        Copyright_Violation: [
            "Your account is suspended for 30 days due to posting content that infringes on copyright laws and violates our community guidelines. Please ensure that you have the right to share any content you post."
        ],
        Privacy_Violation: [
            "Your account is suspended for 30 days due to posting content that violates privacy guidelines by sharing personal information without consent. Please respect others' privacy."
        ],
    },   
    Ban_Account: [ // permanent ban of account if 15 posts/contents are reported based on any of the violation type
        "Your account has been banned due to repeated violations of our community guidelines."
    ],  
};