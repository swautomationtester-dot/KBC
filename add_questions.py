import json, re
p='/mnt/data/kbc_work/questions.json'
q=json.load(open(p,encoding='utf8'))
new=[]
def add(id_,cat,diff,text,opts,ans):
    new.append({'id':id_,'category':cat,'difficulty':diff,'text':text,'options':opts,'answer':ans})

# South Indian cinema
cat='South Indian Cinema'
items=[
(1,1,'Which Tamil film features the character Chitti, a humanoid robot?',['Enthiran','Kaithi','96','Vikram'],0),
(2,1,'In which language was the film RRR primarily made?',['Telugu','Tamil','Malayalam','Kannada'],0),
(3,1,'Which actor played the lead role of Devasena in Baahubali: The Beginning?',['Anushka Shetty','Nayanthara','Samantha Ruth Prabhu','Trisha'],0),
(4,1,'Which city is the film industry commonly known as Sandalwood associated with?',['Bengaluru','Hyderabad','Chennai','Kochi'],0),
(5,2,'Who directed the Telugu film Eega?',['S. S. Rajamouli','Mani Ratnam','Gautham Vasudev Menon','Lokesh Kanagaraj'],0),
(6,2,'Which Malayalam film won the National Film Award for Best Feature Film in 2019?',['Marakkar: Lion of the Arabian Sea','Bhonsle','Vada Chennai','Kumbalangi Nights'],0),
(7,2,'Which Tamil actor played the title role in the film Vada Chennai?',['Dhanush','Suriya','Vijay','Karthi'],0),
(8,2,'Which Kannada film became the first Kannada film to gross over ₹100 crore worldwide?',['Mungaru Male','K.G.F: Chapter 1','Kantara','K.G.F: Chapter 2'],1),
(9,3,'Who composed the music for the Tamil film Roja?',['A. R. Rahman','Ilaiyaraaja','Anirudh Ravichander','Harris Jayaraj'],0),
(10,3,'Which actor portrayed Rocky in K.G.F: Chapter 1?',['Yash','Puneeth Rajkumar','Darshan','Sudeep'],0),
(11,3,'Who directed the Malayalam film Drishyam?',['Jeethu Joseph','Lijo Jose Pellissery','Dileesh Pothan','Aashiq Abu'],0),
(12,3,'Which Tamil film features the song Why This Kolaveri Di?',['3','VIP','Maari','Anegan'],0),
(13,4,'Which South Indian film became the first Indian film to win the Academy Award for Best Original Song?',['RRR','Baahubali 2','Kantara','Jai Bhim'],0),
(14,4,'Who directed the Kannada film Kantara?',['Rishab Shetty','Prashanth Neel','Hemanth Rao','Rakshit Shetty'],0),
(15,4,'Which Malayalam actor played Georgekutty in Drishyam?',['Mohanlal','Mammootty','Fahadh Faasil','Prithviraj Sukumaran'],0),
(16,4,'Which filmmaker directed both Mouna Ragam and Bombay?',['Mani Ratnam','Shankar','Bharathiraja','Vetrimaaran'],0),
(17,4,'Who directed the Tamil film Vikram, released in 2022?',['Lokesh Kanagaraj','Karthik Subbaraj','Pa. Ranjith','Atlee'],0),
(18,2,'Which Telugu actor played the role of Bheem in RRR?',['N. T. Rama Rao Jr.','Ram Charan','Allu Arjun','Prabhas'],0),
(19,2,'Which film stars Dulquer Salmaan as a soldier named Ram?',['Sita Ramam','Charlie','Kurup','Ustad Hotel'],0),
(20,3,'Which Kannada actor starred in the film 777 Charlie?',['Rakshit Shetty','Yash','Sudeep','Shiva Rajkumar'],0),
]
for i,d,t,o,a in items:add(f'SIC-{i:03}',cat,d,t,o,a)

# Indian cinema
cat='Indian Cinema'
items=[
(1,1,'Who is known as the Father of Indian Cinema?',['Dadasaheb Phalke','Satyajit Ray','Raj Kapoor','Guru Dutt'],0),
(2,1,'Which film is widely regarded as India’s first full-length feature film?',['Raja Harishchandra','Alam Ara','Kisan Kanya','Devdas'],0),
(3,1,'Which Hindi film features the character Rancho?',['3 Idiots','PK','Taare Zameen Par','Dangal'],0),
(4,1,'Who played the lead role of Geet in Jab We Met?',['Kareena Kapoor Khan','Priyanka Chopra Jonas','Deepika Padukone','Rani Mukerji'],0),
(5,2,'Who directed Lagaan?',['Ashutosh Gowariker','Rajkumar Hirani','Sanjay Leela Bhansali','Anurag Kashyap'],0),
(6,2,'Which Indian film won the Best Foreign Language Film category at the 1957 Karlovy Vary International Film Festival?',['Do Bigha Zamin','Pather Panchali','Mother India','Mughal-e-Azam'],0),
(7,2,'Which actor played the title role in Bhaag Milkha Bhaag?',['Farhan Akhtar','Ranveer Singh','Ayushmann Khurrana','Rajkummar Rao'],0),
(8,2,'Which film is based on the life of wrestler Mahavir Singh Phogat?',['Dangal','Sultan','Mary Kom','Chak De! India'],0),
(9,3,'Who directed the Apu Trilogy?',['Satyajit Ray','Mrinal Sen','Ritwik Ghatak','Bimal Roy'],0),
(10,3,'Which Indian film was the first to be nominated for the Academy Award for Best Foreign Language Film?',['Mother India','Salaam Bombay!','Lagaan','Pather Panchali'],0),
(11,3,'Who composed the music for the film Dil Se..?',['A. R. Rahman','Vishal Bhardwaj','Shankar-Ehsaan-Loy','Pritam'],0),
(12,3,'Which film won the National Film Award for Best Popular Film Providing Wholesome Entertainment in 2001?',['Kuch Kuch Hota Hai','Lagaan','Swades','Kabhi Khushi Kabhie Gham'],0),
(13,4,'Which director made the films Gangs of Wasseypur and Raman Raghav 2.0?',['Anurag Kashyap','Vishal Bhardwaj','Neeraj Ghaywan','Zoya Akhtar'],0),
(14,4,'Which Indian film won the Palme d’Or at Cannes in 2024?',['No Indian film won it','All We Imagine as Light','Payal Kapadia','The Shameless'],0),
(15,4,'Who directed the 2018 film Andhadhun?',['Sriram Raghavan','R. Balki','Srijit Mukherji','Shoojit Sircar'],0),
(16,4,'Which film became the first Indian production to win the Academy Award for Best Documentary Short Film?',['The Elephant Whisperers','Writing with Fire','Period. End of Sentence.','Smile Pinki'],0),
(17,4,'Who directed the film Masaan?',['Neeraj Ghaywan','Vikramaditya Motwane','Hansal Mehta','Anurag Basu'],0),
(18,2,'Which actor played the role of Milkha Singh in Bhaag Milkha Bhaag?',['Farhan Akhtar','Irrfan Khan','Shahid Kapoor','Ranbir Kapoor'],0),
(19,2,'Which film centers on the Indian women’s national hockey team?',['Chak De! India','Paan Singh Tomar','Gold','M.S. Dhoni: The Untold Story'],0),
(20,3,'Who directed the film Queen?',['Vikas Bahl','Karan Johar','Rajkumar Hirani','Imtiaz Ali'],0),
]
for i,d,t,o,a in items:add(f'IC-{i:03}',cat,d,t,o,a)

# Politics / Indian polity, mostly stable facts
cat='Politics & Indian Polity'
items=[
(1,1,'Who is known as the Father of the Indian Constitution?',['B. R. Ambedkar','Jawaharlal Nehru','Sardar Patel','Rajendra Prasad'],0),
(2,1,'How many houses does the Parliament of India have?',['Two','One','Three','Four'],0),
(3,1,'What is the lower house of the Parliament of India called?',['Lok Sabha','Rajya Sabha','Vidhan Sabha','Gram Sabha'],0),
(4,1,'What is the upper house of the Parliament of India called?',['Rajya Sabha','Lok Sabha','Vidhan Parishad','Zila Parishad'],0),
(5,2,'Who was the first President of independent India?',['Dr. Rajendra Prasad','S. Radhakrishnan','Zakir Husain','V. V. Giri'],0),
(6,2,'Who was the first Prime Minister of independent India?',['Jawaharlal Nehru','Sardar Vallabhbhai Patel','Lal Bahadur Shastri','Rajendra Prasad'],0),
(7,2,'Which part of the Indian Constitution contains Fundamental Rights?',['Part III','Part I','Part IV','Part V'],0),
(8,2,'The voting age in India was reduced from 21 to 18 by which constitutional amendment?',['61st Amendment','42nd Amendment','44th Amendment','73rd Amendment'],0),
(9,3,'Which article guarantees equality before the law in India?',['Article 14','Article 19','Article 21','Article 32'],0),
(10,3,'Who was the first woman President of India?',['Pratibha Patil','Indira Gandhi','Sarojini Naidu','Sushma Swaraj'],0),
(11,3,'Which constitutional amendment gave constitutional status to Panchayati Raj institutions?',['73rd Amendment','74th Amendment','42nd Amendment','86th Amendment'],0),
(12,3,'Which constitutional amendment is associated with municipalities?',['74th Amendment','73rd Amendment','61st Amendment','101st Amendment'],0),
(13,4,'Who chaired the Drafting Committee of the Constituent Assembly?',['B. R. Ambedkar','B. N. Rau','Rajendra Prasad','Jawaharlal Nehru'],0),
(14,4,'Which schedule of the Constitution deals with allocation of seats in the Rajya Sabha?',['Fourth Schedule','First Schedule','Seventh Schedule','Tenth Schedule'],0),
(15,4,'Which constitutional amendment introduced the Goods and Services Tax framework?',['101st Amendment','97th Amendment','86th Amendment','73rd Amendment'],0),
(16,4,'Who was the first woman to become President of the Indian National Congress?',['Annie Besant','Sarojini Naidu','Vijaya Lakshmi Pandit','Indira Gandhi'],0),
(17,4,'Which body conducts elections to Parliament and state legislatures in India?',['Election Commission of India','Union Public Service Commission','Finance Commission','NITI Aayog'],0),
(18,2,'The Constitution of India was adopted on which date?',['26 November 1949','15 August 1947','26 January 1950','2 October 1949'],0),
(19,2,'The Constitution of India came into force on which date?',['26 January 1950','26 November 1949','15 August 1947','2 October 1950'],0),
(20,3,'Which Fundamental Right is protected by Article 21?',['Right to life and personal liberty','Right to property','Right to education','Right against exploitation'],0),
]
for i,d,t,o,a in items:add(f'POL-{i:03}',cat,d,t,o,a)

# Technology
cat='Technology'
items=[
(1,1,'What does CPU stand for?',['Central Processing Unit','Computer Primary Unit','Central Program Utility','Core Processing Utility'],0),
(2,1,'Which company developed the Android operating system originally?',['Android Inc.','IBM','Nokia','Oracle'],0),
(3,1,'What does URL stand for?',['Uniform Resource Locator','Universal Record Link','Unified Resource Link','User Routing Locator'],0),
(4,1,'Which technology is commonly used for tap-to-pay transactions?',['NFC','FTP','SMTP','HDMI'],0),
(5,2,'What does RAM stand for?',['Random Access Memory','Read Access Module','Rapid Application Memory','Remote Access Memory'],0),
(6,2,'Which programming language was created by Guido van Rossum?',['Python','Java','C#','Ruby'],0),
(7,2,'What does HTTPS add to HTTP?',['Encryption and authentication via TLS','Faster image loading','Offline storage','Compression only'],0),
(8,2,'Which database system is known for documents stored in BSON-like format?',['MongoDB','MySQL','SQLite','PostgreSQL'],0),
(9,3,'What does GPU stand for?',['Graphics Processing Unit','General Processing Utility','Graphical Program Unit','Global Processing Unit'],0),
(10,3,'Which protocol is primarily used to translate domain names into IP addresses?',['DNS','DHCP','SSH','FTP'],0),
(11,3,'What is the main purpose of a firewall?',['Control network traffic based on security rules','Increase screen resolution','Store passwords in plain text','Compress videos'],0),
(12,3,'Which cloud service model provides virtual machines and networking resources?',['IaaS','SaaS','PaaS','DaaS'],0),
(13,4,'What does SQL stand for?',['Structured Query Language','System Query Logic','Sequential Question Language','Structured Queue Logic'],0),
(14,4,'Which data structure follows LIFO order?',['Stack','Queue','Heap','Graph'],0),
(15,4,'What is the primary purpose of public-key cryptography?',['Secure communication using key pairs','Increase CPU clock speed','Compress databases','Render graphics'],0),
(16,4,'Which HTTP status code means “Not Found”?',['404','200','301','500'],0),
(17,4,'What does API commonly stand for in software development?',['Application Programming Interface','Advanced Program Integration','Application Process Instruction','Automated Programming Internet'],0),
(18,2,'Which file format is commonly used for structured data exchanged by web APIs?',['JSON','BMP','MP3','EXE'],0),
(19,2,'What does IoT stand for?',['Internet of Things','Integration of Technology','Internet of Tools','Interface of Terminals'],0),
(20,3,'Which technology is the foundation of cryptocurrencies such as Bitcoin?',['Blockchain','Bluetooth','Virtual Reality','Optical networking'],0),
]
for i,d,t,o,a in items:add(f'TECH-{i:03}',cat,d,t,o,a)

# Validate uniqueness and IDs
existing_ids={x['id'] for x in q}
existing_text={re.sub(r'\W+',' ',x['text'].lower()).strip() for x in q}
for x in new:
    assert x['id'] not in existing_ids, x['id']
    key=re.sub(r'\W+',' ',x['text'].lower()).strip()
    assert key not in existing_text, x['text']
    existing_ids.add(x['id']); existing_text.add(key)
q.extend(new)
json.dump(q,open(p,'w',encoding='utf8'),ensure_ascii=False,indent=2)
print('questions:',len(q),'added:',len(new))
from collections import Counter
print(Counter(x['category'] for x in q))
