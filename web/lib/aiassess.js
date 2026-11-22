/* AI Use Case Intake & Assessment: the questions, the rules and the verdict. Pure (no page access); exports window.AIAssess.
   Method: a practitioner method for AI use-case assessments: assess the USE, start from facts, record why a category is ruled out,
   treat "not sure" as a finding, go deep only where the screen says so, never let a number replace judgement.
   There is NO score. Classification (a legal question) is kept apart from controls (a management question); a critical gap is not
   offset by good answers elsewhere; unknown answers are never counted as compliant. Nothing here is a legal opinion. */
(() => {
  "use strict";

  const STAGES = [["idea", "Idea or proposal"], ["pilot", "Pilot or trial"], ["live", "Already in use"], ["retiring", "Being retired"]];
  const BUILDS = [
    ["buy", "We buy or subscribe to a finished AI product and use it as supplied"],
    ["embedded", "A product we already use has added AI features"],
    ["build_api", "We build our own tool on someone else's model (API, fine-tuning, retrieval, agents) for our own staff"],
    ["sell", "We build or wrap AI and offer it to other organisations or to customers"],
    ["selfhost", "We run an open-weight model ourselves"],
    ["shadow", "People already use a public AI tool that nobody approved"],
  ];
  const AUTONOMY = [
    ["suggest", "It only suggests or drafts; a person decides and could do the work without it"],
    ["decides", "A person decides, using its output as an important input"],
    ["reviews", "It acts, and a person reviews afterwards (or only a sample)"],
    ["acts", "It acts or decides with no person in the loop"],
  ];
  const SCALE = [["low", "Low volume: a person could do the same work"], ["high", "High volume: a person could not realistically do the same work"]];
  const PEOPLE = [["customers", "Customers or clients"], ["leads", "Prospective customers (leads)"], ["staff", "Our staff"], ["applicants", "Job applicants"], ["suppliers", "Suppliers and contractors"], ["public", "Members of the public (website visitors, followers, event attendees)"], ["minors", "Patients, children or other vulnerable people"], ["none", "Nobody (no people are affected)"]];
  const DATA = [["financial", "Financial or account information"], ["confidential", "Confidential business information, or information under a secrecy duty"], ["code", "Source code"]];

  const SECTIONS = [
    { id: "intake", title: "The use case", short: "Use case", intro: "Describe the USE, not the model: the same model drafting e-mails and screening people falls under different rules. Facts, not labels: \"it is just a tool\" and \"a person reviews it\" are claims to test." },
    { id: "scope", title: "Which rules apply", short: "Rules", intro: "Decide which regimes apply to this use, and record why not for the ones that do not. Answer \"Not sure\" when you do not know: unknown is a finding, not a pass." },
    { id: "act", title: "EU AI Act class", short: "EU AI Act", intro: "Classified in this order: prohibited, high-risk, transparency, general-purpose model, minimal. Classify the intended purpose AND the real use. Unclear means escalate, never default to the lower class." },
    { id: "data", title: "Personal data", short: "Data", intro: "Applies whenever personal data is in the inputs, the outputs (scores, inferences, profiles) or the logs, whatever the AI Act says. It is shown when you did not answer No to personal data." },
    { id: "chain", title: "Supplier, security and resilience", short: "Supplier", intro: "Follow the data from source to output and storage, through every party in the chain." },
    { id: "perf", title: "Testing and human oversight", short: "Testing", intro: "Before go-live, decide how you will judge whether it works well. Test it on examples where you already know the right answer. Set up the human review so that the reviewer can really disagree with it." },
    { id: "gov", title: "Governance", short: "Governance", intro: "Who owns it, who accepts the risk, and when it is looked at again." },
  ];

  const PROH = ["p_manip", "p_vuln", "p_social", "p_crime", "p_scrape", "p_emotion", "p_biocat", "p_rbi"];
  const HIGH = ["h_bio", "h_infra", "h_edu", "h_emp", "h_serv", "h_law", "h_mig", "h_just", "h_ann1"];
  const TRANS = ["t_int", "t_syn", "t_emo"];

  // ---- the questions -------------------------------------------------------------------------------------------------------------
  // fact: the answer describes the world (Yes triggers something).  ctl: a control (Yes = in place, No = gap, Not sure = open item).
  const Q = [];
  const F = (id, sec, text, hint, ref, when) => Q.push({ id, sec, kind: "fact", text, hint, ref, when });
  const C = (id, sec, text, ref, o) => Q.push(Object.assign({ id, sec, kind: "ctl", text, ref, lvl: 2, sev: "major", fix: "" }, o));
  const G = "Guide ";

  F("eu", "scope", "Is the system, or its output, used in the EU?", "Placed on the EU market, put into service in the EU, or its output is used in the EU. Answer No only if nobody in the EU is reached.", G + "17.6.8 step 2; EU AI Act Art 2");
  F("pd", "scope", "Does it process personal data?", "Inputs (customer, staff or third-party data, recordings, images, text that identifies people), outputs (scores, inferences, profiles) and logs all count.", G + "17.6.8 step 2");
  F("fin", "scope", "Is your organisation a financial entity under DORA (bank, insurer, investment firm, payment or e-money institution, crypto-asset provider and others), or an ICT provider to one?", "DORA applies by who you are, not by what the AI does, so a harmless AI tool can still fall under it.", G + "17.6.8 step 2; Part 3");
  F("nis2", "scope", "Is your organisation an essential or important entity under NIS2, or a supplier to one?", "", G + "17.6.8 step 2; Part 26");
  F("sector", "scope", "Do other sector rules apply: financial crime, consumer, labour, health, public sector, confidentiality or secrecy duties?", "", G + "17.6.8 step 2");
  F("contract", "scope", "Do customer contracts, a regulator's expectations or internal policy limit AI use or sending data to suppliers?", "", G + "17.6.8 step 2");
  F("mgmt", "scope", "Is the work inside the scope of an ISO/IEC 42001, 27001 or 27701 certification?", "", G + "17.6.8 step 2");

  const when_eu = c => c.v("eu") !== "no";
  const AR = "EU AI Act Art 5";
  F("p_manip", "act", "Does it use subliminal, manipulative or deceptive techniques that distort people's behaviour and can cause them significant harm?", "", AR, when_eu);
  F("p_vuln", "act", "Does it exploit people's vulnerabilities (age, disability, social or economic situation) to distort their behaviour?", "", AR, when_eu);
  F("p_social", "act", "Does it score or rank people on social behaviour or personal traits, leading to harmful or unjustified treatment (social scoring)?", "", AR, when_eu);
  F("p_crime", "act", "Does it predict that a person will commit a crime based only on profiling or personality traits?", "", AR, when_eu);
  F("p_scrape", "act", "Does it build or enlarge face databases by untargeted scraping of images from the internet or CCTV?", "", AR, when_eu);
  F("p_emotion", "act", "Does it infer emotions of people at work or in education (except for medical or safety reasons)?", "", AR, when_eu);
  F("p_biocat", "act", "Does it sort people by biometric data to infer race, political opinions, union membership, religion, sex life or sexual orientation?", "", AR, when_eu);
  F("p_rbi", "act", "Is it real-time remote biometric identification in public places for law enforcement?", "Narrow exceptions exist; if you think one applies, escalate to legal.", AR, when_eu);

  const AN = "EU AI Act Annex III";
  F("h_bio", "act", "Biometrics: remote biometric identification, biometric categorisation, or emotion recognition?", "", AN, when_eu);
  F("h_infra", "act", "Critical infrastructure: digital infrastructure, road traffic, supply of water, gas, heating or electricity?", "", AN, when_eu);
  F("h_edu", "act", "Education and vocational training: for example admission, assessing learners or monitoring exams?", "", AN, when_eu);
  F("h_emp", "act", "Employment and workers' management: recruiting, screening, promotion, task allocation, monitoring or evaluating workers, access to self-employment?", "", AN, when_eu);
  F("h_serv", "act", "Access to essential services and benefits: public-benefit eligibility, creditworthiness or credit scoring (not fraud detection), risk assessment and pricing for life and health insurance, emergency-call triage?", "", AN, when_eu);
  F("h_law", "act", "Law enforcement?", "", AN, when_eu);
  F("h_mig", "act", "Migration, asylum and border control?", "", AN, when_eu);
  F("h_just", "act", "Administration of justice and democratic processes?", "", AN, when_eu);
  F("h_ann1", "act", "Is it a safety component of, or itself, a product under EU product-safety law (Annex I) such as a medical device, machine or vehicle, that needs third-party conformity assessment?", "", G + "17.4 (Art 6(1))", when_eu);
  const when_hi = c => when_eu(c) && c.hy;
  F("d_prof", "act", "Does it profile natural persons?", "An Annex III system that profiles natural persons is always high-risk, whatever else is true.", G + "17.4 (Art 6(3))", when_hi);
  F("d_narrow", "act", "Does it only do a narrow procedural task, improve the result of work a person already finished, detect patterns in decisions without replacing human assessment, or do a preparatory task?", "If yes, and it poses no significant risk to health, safety or fundamental rights, the Art 6(3) derogation may apply. Test it honestly: it must be documented and registered.", G + "17.4 (Art 6(3))", when_hi);
  F("t_int", "act", "Does it interact directly with people (chatbot, voice assistant)?", "", G + "17.4 (Art 50)", when_eu);
  F("t_syn", "act", "Does it generate or manipulate audio, images, video or text: synthetic content, deepfakes, text published to inform the public?", "", G + "17.4 (Art 50)", when_eu);
  F("t_emo", "act", "Does it do emotion recognition or biometric categorisation of people?", "", G + "17.4 (Art 50)", when_eu);
  F("g_model", "act", "Do you train or release a general-purpose AI model for others to build on?", "Fine-tuning or wrapping a model is usually a system question, not a model question.", G + "17.7.3", when_eu);
  F("g_sys", "act", "Is that model above the systemic-risk threshold (10^25 FLOPs in the initial guidance) or designated by the Commission?", "", G + "17.7.3", c => when_eu(c) && c.y("g_model"));
  const when_role = c => when_eu(c) && ["buy", "embedded", "sell", "build_api", "selfhost"].includes(c.f.build || "");
  F("r_own", "act", "Do you put your own name or trademark on a high-risk system someone else built?", "", G + "17.7.1 (Art 25)", c => when_role(c) && c.tierHigh);
  F("r_subst", "act", "Do you make a substantial modification to a high-risk system that leaves it high-risk?", "", G + "17.7.1 (Art 25)", c => when_role(c) && c.tierHigh);
  F("r_purpose", "act", "Do you change the intended purpose of a non-high-risk system so that it becomes high-risk?", "", G + "17.7.1 (Art 25)", when_role);
  F("r_imp", "act", "Do you bring a system into the EU from a provider outside the EU (importer)?", "", G + "17.7.1 (Arts 23, 24)", c => when_role(c) && ["buy", "embedded"].includes(c.f.build || ""));
  F("r_dist", "act", "Do you make a system available on the market without being its provider or importer (distributor)?", "", G + "17.7.1 (Arts 23, 24)", c => when_role(c) && ["buy", "embedded"].includes(c.f.build || ""));
  F("r_public", "act", "Are you a public body, or a private organisation providing public services?", "Decides whether the fundamental rights impact assessment (Art 27) applies to you as a deployer.", G + "17.7.1 (Art 27)", c => when_eu(c) && c.tierHigh);

  C("derog_doc", "act", "The Art 6(3) assessment is documented before the system is placed on the market, and the system is registered", G + "17.4", { sev: "crit", lvl: 1, when: c => c.tier === "derog", fix: "Write down why there is no significant risk to health, safety or fundamental rights, and register the system. Without it, treat the system as high-risk." });
  C("t_disclose", "act", "People are told they are dealing with AI, and synthetic content is marked as such", G + "17.4 (Art 50)", { sev: "crit", lvl: 1, when: c => c.transp, fix: "Add a clear notice where people meet the system, and mark synthetic output so it can be recognised." });
  const HR = [
    ["hr1", "A continuous risk management system runs through the lifecycle (Art 9)"], ["hr2", "Training and test data is governed: sourced, representative, checked for bias (Art 10)"],
    ["hr3", "Technical documentation is complete and kept up to date (Art 11)"], ["hr4", "Operation is logged automatically; logs are kept at least six years (Art 12)"],
    ["hr5", "Users and deployers receive clear information on capabilities and limits (Art 13)"], ["hr6", "Humans can monitor, intervene and override (Art 14)"],
    ["hr7", "Accuracy, robustness and cybersecurity are tested, including against adversarial input (Art 15)"], ["hr8", "A quality management system covers design to monitoring (Art 17)"],
    ["hr9", "Conformity assessment is done and the CE mark and declaration of conformity are in place before release (Art 43)"], ["hr10", "A contact person can cooperate with the market surveillance authorities (Art 21)"],
  ];
  HR.forEach(([id, t], i) => C(id, "act", t, G + "17.7.2 (obligation " + (i + 1) + ")", { sev: i === 8 ? "crit" : "major", lvl: 1, when: c => c.tier === "high" && c.provider, fix: "Provider obligation " + (i + 1) + " of the ten (Arts 9 to 17, 21 and 43)." }));
  const HD = [
    ["hd1", "The system is used according to the provider's instructions for use (Art 26)"], ["hd2", "Human oversight is given to people with the competence, training and authority for it"],
    ["hd3", "Input data you control is relevant and representative"], ["hd4", "Operation is monitored; the provider and authorities are informed; use is suspended if a risk appears; serious incidents are reported"],
    ["hd5", "Automatically generated logs are kept for at least six months"], ["hd6", "Workers' representatives and affected workers are informed before use at work"],
  ];
  HD.forEach(([id, t]) => C(id, "act", t, G + "17.7.1 (Art 26)", { sev: "major", lvl: 1, when: c => c.tier === "high" && c.deployer && (id !== "hd6" || (c.f.people || []).includes("staff") || (c.f.people || []).includes("applicants")), fix: "The deployer duties are in Art 26." }));
  C("hd_fria", "act", "A fundamental rights impact assessment (Art 27) was carried out", G + "17.7.1 (Art 27)", { sev: "crit", lvl: 1, when: c => c.tier === "high" && c.deployer && (c.y("r_public") || c.y("h_serv")), fix: "Carry it out before use; it applies to public bodies, private entities providing public services, and the credit-scoring and life/health-insurance uses." });
  const GP = [["gp1", "Technical documentation of the model is kept"], ["gp2", "A summary of the training data is published"], ["gp3", "A copyright compliance policy exists"], ["gp4", "Downstream providers and deployers receive the information they need"]];
  GP.forEach(([id, t]) => C(id, "act", t, G + "17.7.3", { sev: "major", lvl: 1, when: c => c.y("g_model"), fix: "See the obligations for general-purpose AI models." }));
  C("gp5", "act", "Systemic-risk model: adversarial testing, incident reporting to the EU AI Office, cybersecurity measures and energy reporting are in place", G + "17.7.3", { sev: "crit", lvl: 1, when: c => c.y("g_model") && c.y("g_sys"), fix: "See the extra duties for systemic-risk models." });

  // personal data
  const when_pd = c => c.v("pd") !== "no";
  const DPT = G + "17.6.8 step 5; Part 2";
  F("dp_sp", "data", "Does it handle special categories: health, beliefs, union membership, biometric data used to identify, sex life? Voice and images can allow biometric identification.", "", DPT, when_pd);
  F("dp_prof", "data", "Does it profile, score or predict things about people?", "", DPT, when_pd);
  F("dp_mon", "data", "Does it monitor people systematically, or at scale?", "Recording, quality-assuring calls, tracking behaviour or screening communications.", DPT, when_pd);
  F("dp_dec", "data", "Does its output feed decisions with legal or similarly significant effect on a person: hiring, credit, benefits, access to a service, discipline?", "", DPT, when_pd);
  F("dp_auto", "data", "Is any such decision taken without meaningful human involvement (GDPR Art 22)?", "Test it: a reviewer who clicks approve on everything is a rubber stamp.", DPT + " (Art 22)", c => when_pd(c) && (c.y("dp_dec") || c.v("dp_dec") === "unk"));
  F("dp_new", "data", "Is the technology new to your organisation, or novel in how it uses the data?", "A language model used on customer data is an example.", DPT, when_pd);
  F("dp_xfer", "data", "Does the supplier, or any of its sub-processors, process the data outside the EU/EEA?", "", DPT + " (Chapter V)", c => when_pd(c) && c.f.build !== "selfhost");
  C("dc_basis", "data", "A lawful basis and the purpose of the processing are documented, and the system is not used for other purposes", DPT, { sev: "crit", lvl: 1, when: when_pd, fix: "Document the lawful basis and purpose before go-live; a monitoring purpose must not quietly grow." });
  C("dc_notice", "data", "The people whose data is used are informed (staff, callers, customers and leads included)", DPT, { sev: "major", lvl: 1, when: when_pd, fix: "Update the privacy notice and any call, chat or workplace notices." });
  C("dc_proc", "data", "A processor agreement (GDPR Art 28) covers retention, use for training, sub-processors and deletion", DPT + " (Art 28)", { sev: "crit", lvl: 1, when: c => when_pd(c) && c.f.build !== "selfhost", fix: "Do not send personal data to the supplier until the agreement is signed and reviewed." });
  C("dc_train", "data", "The supplier may not use your data to train its models (or you decided otherwise and told the people concerned)", G + "17.11.2", { sev: "major", lvl: 1, when: c => when_pd(c) && c.f.build !== "selfhost", fix: "Turn training off in the contract or the tenant settings, and keep the evidence." });
  C("dc_xfer", "data", "A transfer mechanism is in place for processing outside the EU/EEA (GDPR Chapter V)", DPT + " (Chapter V)", { sev: "crit", lvl: 2, when: c => c.y("dp_xfer"), fix: "Use an adequacy decision, standard contractual clauses or another valid mechanism, with a transfer assessment." });
  C("dc_dpia", "data", "A DPIA (GDPR Art 35) was done before go-live, or a recorded decision shows that none is needed", G + "17.6.8 step 5; Part 22", { sev: "crit", lvl: 2, when: c => when_pd(c) && c.dpiaTrig.some(id => c.v(id) !== "no"), fix: "Do the DPIA; profiling, systematic monitoring, special categories, significant decisions and new technology all trigger it." });
  C("dc_human", "data", "A person can genuinely disagree: the reviewer has the competence, authority and time, and overrides are recorded", G + "17.6.8 step 5 (Art 22)", { sev: "crit", lvl: 2, when: c => c.y("dp_auto") || c.y("dp_dec"), fix: "Make the review real (time, training, authority), record override rates, or redesign so that the decision is not automated." });
  C("dc_contest", "data", "People get an explanation and a way to contest the outcome", G + "17.6.8 step 7", { sev: "major", lvl: 2, when: c => c.y("dp_dec") || c.y("dp_auto"), fix: "Add an explanation and a contact route to the decision letter or screen." });
  C("dc_rights", "data", "Access, erasure and objection requests can be handled across prompts, outputs and logs", G + "17.11.4", { sev: "major", lvl: 2, when: when_pd, fix: "Find where prompts, outputs and logs are stored and who can search and delete them." });
  C("dc_ropa", "data", "The use is in the record of processing activities (Art 30)", DPT + " (Art 30)", { sev: "minor", lvl: 2, when: when_pd, fix: "Add an entry." });
  C("dc_breach", "data", "Breach handling covers incidents at the AI supplier (Art 33 and 34)", DPT + " (Art 33, 34)", { sev: "major", lvl: 2, when: when_pd, fix: "Add the supplier to the breach procedure, with a notification time in the contract." });
  C("dc_staff", "data", "Workers were informed and consulted where required, and the employee-monitoring rules were checked", G + "17.6.8 step 5", { sev: "major", lvl: 2, when: c => when_pd(c) && ((c.f.people || []).includes("staff") || (c.f.people || []).includes("applicants")), fix: "Check the national employee-monitoring and works-council rules." });

  // supplier, security, resilience
  const SC = G + "17.6.8 step 6";
  F("sc_reads", "chain", "Does it read content you do not control: e-mails, web pages, uploaded documents, transcripts?", "Any such content can carry instructions to the model (prompt injection).", SC);
  F("sc_agent", "chain", "Can it take actions or call tools: send, change, delete, pay, run code?", "", G + "17.8");
  F("fin_imp", "chain", "Does it support a critical or important function of the financial entity?", "", G + "17.6.8 step 2; Part 3", c => c.y("fin"));
  C("sc_flow", "chain", "A data-flow diagram exists from source to output and storage, with every party in the chain", SC, { sev: "major", lvl: 1, fix: "Draw it, including the model provider, platform, plugins, hosting region and sub-processors." });
  C("sc_terms", "chain", "The supplier's terms were reviewed: retention, training use, region, sub-processors, availability, exit", SC, { sev: "major", lvl: 1, when: c => c.f.build !== "selfhost", fix: "Read the terms and record the answers; a vendor that added AI to a product you own needs a new review." });
  C("sc_secrecy", "chain", "Confidentiality and secrecy duties were checked: what may leave the organisation and where it may go", SC, { sev: "crit", lvl: 1, when: c => (c.f.data || []).includes("confidential") || c.y("sector"), fix: "Confirm with legal what may be sent to the supplier, and block the rest." });
  C("sc_pin", "chain", "Model changes are announced or pinned to a version, and the use is retested after a change", SC, { sev: "major", lvl: 2, when: c => c.f.build !== "selfhost", fix: "Pin the model version if possible, and rerun the test set on every change." });
  C("sc_inj", "chain", "Prompt injection from content it reads is tested and limited", SC, { sev: "major", lvl: 2, when: c => c.y("sc_reads"), fix: "Treat everything it reads as untrusted; limit what a manipulated model could do." });
  C("sc_tools", "chain", "Tool and file access is least-privilege, actions pass approval gates, runaway actions are limited, secrets are protected, and it runs in a sandbox", G + "17.8", { sev: "crit", lvl: 2, when: c => c.y("sc_agent"), fix: "Cut permissions to what is needed, add approval for irreversible actions and set rate and spend limits." });
  C("sc_halt", "chain", "Someone can stop it immediately, its risky actions can be undone, and there is an escalation path when it goes beyond its limits", G + "17.8", { sev: "major", lvl: 2, when: c => c.y("sc_agent"), fix: "Name who can switch it off, make irreversible actions need approval, and define what happens when it leaves its limits." });
  C("sc_out", "chain", "Outputs are validated before anyone acts on them or publishes them", SC, { sev: "major", lvl: 2, fix: "Add a check or a human step before output reaches a customer, a system or the public." });
  C("sc_log", "chain", "Inputs, outputs, scores and rationale are logged as an audit trail that cannot be altered", SC, { sev: "major", lvl: 2, fix: "Log them with the model version, protect the log and set a retention period." });
  C("sc_assure", "chain", "Supplier assurance was reviewed (ISO/IEC 27001, ISO/IEC 42001, SOC 2)", SC, { sev: "minor", lvl: 2, when: c => c.f.build !== "selfhost", fix: "Ask for the reports and read the scope." });
  C("sc_fallback", "chain", "A fallback exists if the service is down or the supplier stops it, and lock-in was assessed", SC, { sev: "major", lvl: 2, fix: "Define what the business does without it, and how it could move to another supplier." });
  C("sc_ip", "chain", "Copyright and ownership of outputs, and the provenance of training data, were checked", G + "17.3 (ANEC-AI-3)", { sev: "minor", lvl: 2, when: c => c.y("t_syn") || c.y("g_model"), fix: "Check the supplier's IP terms and your own use of outputs." });
  const DO = G + "17.6.8 step 2; Parts 3, 20, 26";
  C("do_reg", "chain", "The AI supplier is in the register of information (DORA Art 28)", DO, { sev: "major", lvl: 1, when: c => c.y("fin"), fix: "Add the supplier and the function it supports." });
  C("do_ict", "chain", "The AI is in the ICT asset inventory and inside the ICT risk management framework (Arts 6 to 9)", DO, { sev: "major", lvl: 2, when: c => c.y("fin"), fix: "Register the asset and add it to the risk framework." });
  C("do_contract", "chain", "The contract has the DORA Art 30 provisions: processing locations, subcontracting and, for critical functions, the extra ones", DO + " (Art 30)", { sev: "major", lvl: 2, when: c => c.y("fin"), fix: "Renegotiate the missing provisions before relying on the service." });
  C("do_exit", "chain", "An exit strategy exists and substitutability was assessed", DO, { sev: "major", lvl: 2, when: c => c.y("fin"), fix: "Document an exit plan and test it." });
  C("do_conc", "chain", "Concentration risk was assessed (Art 29)", DO, { sev: "major", lvl: 2, when: c => c.y("fin"), fix: "Record how dependent you are on this supplier and its own providers." });
  C("do_bcp", "chain", "Business continuity and recovery cover the AI service (Art 11)", DO, { sev: "major", lvl: 2, when: c => c.y("fin"), fix: "Add the service to the continuity plans and test it." });
  C("do_inc", "chain", "Supplier incidents feed your ICT incident classification and reporting (Arts 17 to 19)", DO, { sev: "major", lvl: 2, when: c => c.y("fin"), fix: "Add the supplier's incident channel to the process; the DORA Incident Classification tool shows when a report is due." });
  C("ns_supply", "chain", "Supply-chain security measures under NIS2 cover this supplier", G + "Part 26", { sev: "major", lvl: 2, when: c => c.y("nis2"), fix: "Include the supplier in the supply-chain risk assessment." });

  // testing and oversight
  const PF = G + "17.6.8 step 7";
  C("pf_def", "perf", "Before go-live, you wrote down how you will judge it: how many real problems it may miss, and how many false alarms you will accept", PF, { sev: "major", lvl: 1, fix: "Write the limits down before anyone sees results, for example \"it may miss at most 1 in 20 real problems\"." });
  C("pf_test", "perf", "A test set of real examples with known right answers, including hard ones, exists, and results are recorded with the model version and date", PF, { sev: "major", lvl: 2, fix: "Build the set from real cases and rerun it on every change." });
  C("pf_seg", "perf", "Segments were tested for uneven error rates (language, accent, dialect, demographic groups)", PF, { sev: "major", lvl: 2, when: c => c.v("pd") !== "no" || (c.f.people || []).some(p => p !== "none"), fix: "Split the test results by group and compare." });
  C("pf_adv", "perf", "Adversarial tests were run (jailbreak, prompt injection, misuse)", PF, { sev: "minor", lvl: 3, fix: "Run a red-team session and record the findings." });
  C("pf_drift", "perf", "Drift is monitored and the system is revalidated on a schedule", PF, { sev: "major", lvl: 2, fix: "Pick the measures, the thresholds and the date of the first revalidation." });
  C("ov_who", "perf", "Named reviewers have the competence and the authority to review the output", PF, { sev: "major", lvl: 1, when: c => ["decides", "reviews"].includes(c.f.autonomy || "") || c.tier === "high", fix: "Name the people, train them and give them authority to override." });
  C("ov_bias", "perf", "Automation bias is handled: reviewers also sample low-scored items, and the design stops rubber-stamping", PF, { sev: "major", lvl: 2, when: c => ["decides", "reviews"].includes(c.f.autonomy || "") || c.f.scale === "high", fix: "Review high scores and a sample of low ones, and track override rates." });
  C("ov_override", "perf", "There is an override and escalation path, and override rates are recorded", PF, { sev: "major", lvl: 2, when: c => (c.f.autonomy || "") !== "suggest", fix: "Add an override control and report the rates." });
  C("ov_balance", "perf", "Missed cases (regulatory exposure) are weighed against false alarms (harm to customers, workload)", G + "17.6.8 patterns", { sev: "minor", lvl: 2, when: c => c.f.scale === "high" && c.y("dp_mon"), fix: "Back-test against known cases and tune the thresholds under governance." });

  // governance
  const GV = G + "17.6.8 steps 8 and 9";
  C("gv_owner", "gov", "A business owner and a technical owner are named, and a risk owner who is not the proposer accepts the residual risk", GV, { sev: "major", lvl: 1, fix: "Name them; the person who wants the use case does not accept its risk." });
  C("gv_opin", "gov", "Legal, privacy and security opinions are in the record", GV, { sev: "major", lvl: 1, fix: "Ask each and keep their written view." });
  C("gv_bound", "gov", "What it may do and what it must not do are written down, so its use cannot quietly grow", GV, { sev: "major", lvl: 1, fix: "Write the allowed purpose, the data it may use and the actions it may take, and treat any extension as a new assessment." });
  C("gv_lit", "gov", "The people who use it are trained on what it can and cannot do", "EU AI Act Art 4", { sev: "major", lvl: 1, when: when_eu, fix: "Give users short training on its limits, on checking its output and on the data they may put in, and keep a record." });
  C("gv_inv", "gov", "The use is listed in the AI inventory", GV, { sev: "minor", lvl: 1, fix: "Add it." });
  C("gv_policy", "gov", "It is consistent with the AI acceptable-use policy", G + "17.2", { sev: "minor", lvl: 1, fix: "Compare it with the policy and note any exception." });
  C("gv_shadow", "gov", "The unsanctioned use was stopped or brought into this intake route", G + "17.6.8 patterns", { sev: "major", lvl: 1, when: c => c.f.build === "shadow", fix: "Find who uses it, decide, and give them an approved route." });
  C("gv_risk", "gov", "Risks are written as source, event and consequence, with existing controls, residual rating and treatment", G + "17.6.8 step 8; 17.3, 17.13", { sev: "major", lvl: 2, fix: "Add them to the risk register." });
  C("gv_impact", "gov", "An AI impact assessment (ISO/IEC 42005, nine dimensions) was done and linked to the risk register", G + "17.6.7", { sev: "major", lvl: 3, fix: "Run the ten-step ISO/IEC 42005 impact assessment." });
  C("gv_trig", "gov", "Re-assessment triggers and a review date are set", GV, { sev: "major", lvl: 1, fix: "Set the date and agree the triggers listed in the result." });

  // ---- plain wording -------------------------------------------------------------------------------------------------------------
  // id: [short plain question, explanation shown behind the (i) button, short label for the result text]. The exact original wording stays available behind the (i) button.
  const PLAIN = {
    eu: ["Will anyone in the EU use it, or see its results?", "The EU AI Act applies if the system is sold or used in the EU, or if its results are used in the EU. Answer No only if nobody in the EU is reached."],
    pd: ["Does it handle information about identifiable people?", "That covers what goes in (customer or staff details, recordings, images, text that names people), what comes out (scores, guesses, profiles) and any logs it keeps. Phone calls and recordings of people count."],
    fin: ["Are you a bank, insurer, payment firm or other financial firm (or a technology supplier to one)?", "DORA is the EU rule on digital resilience for financial firms: banks, insurers, investment firms, payment and e-money firms, crypto-asset providers and others, and their ICT suppliers. It applies because of who you are, not because of what the AI does, so even a harmless AI tool can fall under it."],
    nis2: ["Are you in a sector the EU treats as essential, or a supplier to such a company?", "NIS2 is the EU cybersecurity law for sectors such as energy, transport, health, banking and digital infrastructure. If you are not sure whether you are an 'essential or important entity', ask your legal or security team."],
    sector: ["Do other rules apply to this work, such as financial-crime, consumer, employment, health, public-sector or confidentiality rules?", "Think of any rule that already limits what you may do with the data or the decision, whatever the technology."],
    contract: ["Does a customer contract, a regulator or your own policy limit the use of AI, or sending data to suppliers?", ""],
    mgmt: ["Is this work covered by a certification such as ISO 27001, 27701 or 42001?", "These are standards for information security, privacy and AI management. If your certificate covers this work, the standard's rules apply to it too."],

    p_manip: ["Does it trick or manipulate people without their noticing, in a way that could seriously harm them?", "The EU AI Act bans AI that uses hidden or deceptive techniques to change what people do and causes, or is likely to cause, significant harm.", "manipulating people without their noticing"],
    p_vuln: ["Does it take advantage of people's age, disability or money worries to influence what they do?", "", "exploiting people's vulnerabilities"],
    p_social: ["Does it score or rank people by their behaviour or personal traits, so that they are treated worse because of it? (social scoring)", "", "social scoring"],
    p_crime: ["Does it predict that a person will commit a crime just from their profile or personality?", "", "predicting crime from a profile"],
    p_scrape: ["Does it collect face images from the internet or CCTV in bulk to build face databases?", "", "scraping face images in bulk"],
    p_emotion: ["Does it try to read the emotions of people at work or in education? (medical and safety uses are excluded)", "Reading anger, stress or mood from the voice, face or writing of employees or students is banned in the EU, except for medical or safety reasons. A rule that flags what is said (certain words or promises) is a different thing, but if tone or mood is part of it, or you are unsure, answer Not sure.", "reading emotions at work or in education"],
    p_biocat: ["Does it use biometric data (face, voice, fingerprints) to work out a person's race, political views, union membership, religion, sex life or sexual orientation?", "", "sorting people by biometric data to infer sensitive traits"],
    p_rbi: ["Is it live face or body recognition in public places, used by law enforcement?", "Narrow exceptions exist; if you think one applies, escalate to legal.", "live biometric identification in public places for law enforcement"],

    h_bio: ["Does it identify people from their face, voice or body, group them by it, or read their emotions?", "", "biometrics"],
    h_infra: ["Does it run or protect critical infrastructure such as water, gas, heating, electricity, road traffic or digital networks?", "", "critical infrastructure"],
    h_edu: ["Is it used in education or training: admissions, marking or exam monitoring?", "", "education and training"],
    h_emp: ["Is it used for people at work: hiring, screening, promotion, giving out tasks, or monitoring and judging staff?", "This is where many internal tools become 'high-risk'. If its results are used to judge, rate or discipline employees, answer Yes. If it only helps a manager check compliance and nothing is held against a person without further steps, think carefully before answering No.", "employment and workers' management"],
    h_serv: ["Does it decide who gets essential services or benefits: public benefits, credit scores, life or health insurance pricing, emergency-call priority?", "Fraud detection is not included.", "access to essential services and benefits"],
    h_law: ["Is it used by or for law enforcement?", "", "law enforcement"],
    h_mig: ["Is it used for migration, asylum or border control?", "", "migration, asylum and border control"],
    h_just: ["Is it used in courts or to influence elections and voting?", "", "justice and democratic processes"],
    h_ann1: ["Is it a safety part of a regulated product, such as a medical device, machine or vehicle?", "EU product-safety laws (Annex I) cover products that must be checked by an outside body before they are sold.", "a regulated product (Annex I)"],
    d_prof: ["Does it build profiles of individual people?", "A system on the high-risk list that profiles people is always high-risk, whatever else is true."],
    d_narrow: ["Does it do only a small supporting job: a narrow step, polishing work a person already finished, spotting patterns without replacing a person's judgement, or preparing work?", "If yes, and it poses no significant risk to health, safety or fundamental rights, the Art 6(3) exception may apply. Test it honestly: it must be documented and registered."],
    t_int: ["Do people talk or chat directly with it? (chatbot, voice assistant)", ""],
    t_syn: ["Does it create audio, images, video or text that looks real, or text published to inform the public?", ""],
    t_emo: ["Does it read people's emotions, or sort them by biometric data?", ""],
    g_model: ["Do you build or release your own general-purpose AI model for others to use?", "Fine-tuning or wrapping someone else's model is usually a question about the system, not about the model."],
    g_sys: ["Is that model very large (trained with more than 10^25 computing operations) or named by the EU Commission as high-impact?", ""],
    r_own: ["Do you sell a high-risk system that someone else built under your own name or brand?", ""],
    r_subst: ["Do you change a high-risk system so much that it stays high-risk under your responsibility?", ""],
    r_purpose: ["Do you use a system for a new purpose that makes it high-risk?", ""],
    r_imp: ["Do you bring a system into the EU from a supplier outside the EU?", "This makes you an 'importer' under the EU AI Act."],
    r_dist: ["Do you pass a system on to others in the EU without being its maker or importer?", "This makes you a 'distributor' under the EU AI Act."],
    r_public: ["Are you a public body, or a private company providing public services?", "This decides whether you must assess the impact on fundamental rights (Art 27) when you use a high-risk system."],

    derog_doc: ["You wrote down why this system is not high-risk, before launch, and registered it", ""],
    t_disclose: ["People are told they are dealing with AI, and AI-made content is labelled", ""],
    hr1: ["You manage risks continuously, through the whole life of the system", "Art 9."],
    hr2: ["Training and test data is controlled: where it comes from, whether it represents everyone, and whether it is biased", "Art 10."],
    hr3: ["The technical documentation is complete and kept up to date", "Art 11."],
    hr4: ["The system logs what it does automatically, and the logs are kept for at least six years", "Art 12. The period is as the guide states it; confirm it against the current text."],
    hr5: ["Users get clear information on what it can and cannot do", "Art 13."],
    hr6: ["People can watch it, step in and override it", "Art 14."],
    hr7: ["It is tested for accuracy, reliability and security, including against attacks", "Art 15."],
    hr8: ["A quality management system covers everything from design to monitoring", "Art 17."],
    hr9: ["The conformity check is done, and the CE mark and declaration are in place before release", "Art 43."],
    hr10: ["A contact person can work with the market surveillance authorities", "Art 21."],
    hd1: ["You use it as the provider's instructions say", "Art 26."],
    hd2: ["The people overseeing it have the skills, training and authority to do so", ""],
    hd3: ["The data you feed it is relevant and representative", ""],
    hd4: ["You monitor it, tell the provider and the authorities, stop using it if a risk appears, and report serious incidents", ""],
    hd5: ["The logs it creates are kept for at least six months", ""],
    hd6: ["Staff and their representatives are told before it is used at work", ""],
    hd_fria: ["You assessed the impact on people's fundamental rights before using it", "Art 27. It applies to public bodies, private companies providing public services, and the credit-scoring and life or health insurance uses."],
    gp1: ["You keep technical documentation of the model", ""],
    gp2: ["You publish a summary of what the model was trained on", ""],
    gp3: ["You have a copyright policy", ""],
    gp4: ["Others who build on your model get the information they need", ""],
    gp5: ["For a very large model: attack testing, incident reporting to the EU AI Office, security and energy reporting are in place", ""],

    dp_sp: ["Does it handle sensitive personal data: health, beliefs, union membership, sex life, or biometric data used to identify people?", "Voice and images can allow a person to be identified, which makes them biometric data when used for that."],
    dp_prof: ["Does it score, rate or predict things about people?", ""],
    dp_mon: ["Does it watch or check people systematically, or at large scale?", "For example recording or reviewing calls, tracking behaviour, or screening messages."],
    dp_dec: ["Do its results feed decisions that seriously affect a person: hiring, credit, benefits, access to a service, discipline?", ""],
    dp_auto: ["Is any such decision made without real human involvement?", "Test it: a reviewer who clicks approve on everything is a rubber stamp, not human involvement. (GDPR Art 22.)"],
    dp_new: ["Is the technology new to your organisation, or used in a new way on this data?", "A language model used on customer data is an example."],
    dp_xfer: ["Does the supplier, or anyone it uses, handle the data outside the EU/EEA?", "Include the supplier's sub-contractors and any support staff who can open the data."],
    dc_basis: ["You wrote down your legal reason and your purpose for using the data, and it is not used for anything else", ""],
    dc_notice: ["The people whose data it uses have been told (staff, callers and customers included)", ""],
    dc_proc: ["A data-processing contract covers how long data is kept, training use, sub-suppliers and deletion", "GDPR Art 28."],
    dc_train: ["The supplier may not train its models on your data (or you decided otherwise and told the people concerned)", ""],
    dc_xfer: ["There is a legal basis for sending data outside the EU/EEA", "For example an adequacy decision or standard contractual clauses, with a transfer assessment (GDPR Chapter V)."],
    dc_dpia: ["A data protection impact assessment (DPIA) was done before launch, or you recorded why none is needed", "GDPR Art 35. Profiling, systematic monitoring, sensitive data, serious decisions and new technology all point to needing one."],
    dc_human: ["A person can truly disagree with it: the reviewer has the skill, authority and time, and overrides are recorded", ""],
    dc_contest: ["People get an explanation and a way to challenge the outcome", ""],
    dc_rights: ["You can answer requests to see, delete or object to data, including data in prompts, results and logs", ""],
    dc_ropa: ["The use is listed in your records of processing activities", "GDPR Art 30."],
    dc_breach: ["Your data-breach procedure covers incidents at the AI supplier", "GDPR Arts 33 and 34."],
    dc_staff: ["Employees were told and consulted where required, and the local rules on monitoring staff were checked", ""],

    sc_reads: ["Does it read content you do not control: emails, web pages, uploaded documents, recordings or transcripts?", "Such content can carry hidden instructions aimed at the AI (called 'prompt injection')."],
    sc_agent: ["Can it take actions, not just give answers: send, change, delete, pay or run code?", ""],
    fin_imp: ["Does it support a function that is critical or important for the financial firm?", ""],
    sc_flow: ["A diagram shows where the data goes, from source to result and storage, through every party", ""],
    sc_terms: ["You read the supplier's terms: how long data is kept, training use, location, sub-suppliers, availability and exit", ""],
    sc_secrecy: ["You checked confidentiality and secrecy duties: what may leave the organisation, and where it may go", ""],
    sc_pin: ["Model changes are announced or fixed to a version, and you retest after a change", ""],
    sc_inj: ["You tested for hidden instructions in the content it reads, and limited the harm they could do", ""],
    sc_tools: ["Its access to tools and files is kept to the minimum, risky actions need approval, runaway actions are capped, secrets are protected and it runs in a sandbox", ""],
    sc_out: ["Results are checked before anyone acts on them or publishes them", ""],
    sc_log: ["Inputs, results and reasons are logged in a way that cannot be altered", ""],
    sc_assure: ["You reviewed the supplier's security certificates (ISO 27001, ISO 42001, SOC 2)", ""],
    sc_fallback: ["There is a fallback if the service is down or the supplier stops it, and you assessed how hard switching would be", ""],
    sc_ip: ["Copyright and ownership of the results, and where the training data came from, were checked", ""],
    do_reg: ["The AI supplier is listed in your DORA register of information", "DORA Art 28."],
    do_ict: ["The AI is in your list of ICT assets and covered by your ICT risk framework", "DORA Arts 6 to 9."],
    do_contract: ["The contract has the provisions DORA requires: where data is processed, sub-contracting and, for critical functions, extra terms", "DORA Art 30."],
    do_exit: ["An exit plan exists, and you checked whether the supplier can be replaced", ""],
    do_conc: ["You assessed the risk of depending too much on this supplier (concentration risk)", "DORA Art 29."],
    do_bcp: ["Business continuity and recovery plans cover the AI service", "DORA Art 11."],
    do_inc: ["Incidents at the supplier feed your incident classification and reporting", "DORA Arts 17 to 19."],
    ns_supply: ["Your NIS2 supply-chain security measures cover this supplier", ""],

    pf_def: ["Before launch, you wrote down how you will judge it: how many real problems it may miss, and how many false alarms you will accept", "If you decide what 'good' means only after seeing results, almost anything looks good. A missed problem (a risky call that was not flagged) and a false alarm (a harmless call that was flagged) are different mistakes. Decide in advance how many of each you will tolerate."],
    pf_test: ["You have a test set of real examples with known right answers, including hard ones, and you record the results with the model version and date", ""],
    pf_seg: ["You compared results across languages, accents and groups, to see whether mistakes are uneven", ""],
    pf_adv: ["You tried to break it on purpose (jailbreaks, hidden instructions, misuse)", ""],
    pf_drift: ["You watch whether quality slips over time, and recheck it on a schedule", ""],
    ov_who: ["Named people review the results, and they have the skills and the authority to do so", ""],
    ov_bias: ["You guard against people blindly trusting it: reviewers also check some low-scored items", "Automation bias is the habit of accepting what a machine says. Checking a sample of what it did NOT flag shows whether it misses things."],
    ov_override: ["There is a way to override it and escalate, and you record how often people override it", ""],
    ov_balance: ["You weigh missed problems (legal exposure) against false alarms (harm to customers, extra work)", ""],

    gv_owner: ["A business owner and a technical owner are named, and someone other than the requester accepts the remaining risk", ""],
    gv_opin: ["Legal, privacy and security views are in the record", ""],
    gv_inv: ["The use is listed in your AI inventory", ""],
    gv_policy: ["It fits your AI acceptable-use policy", ""],
    gv_shadow: ["The unapproved use was stopped or brought into this approval route", ""],
    gv_risk: ["Risks are written as cause, event and consequence, with controls, remaining rating and plan", ""],
    gv_impact: ["An AI impact assessment (ISO/IEC 42005) was done and linked to the risk register", ""],
    sc_halt: ["Someone can stop it immediately, its risky actions can be undone, and there is an escalation path when it goes beyond its limits", "Tools that act on their own need an off switch and a way back. Decide who can stop it, which actions cannot be undone without approval, and what happens when it leaves the limits you set."],
    gv_bound: ["What it may do and what it must not do are written down, so its use cannot quietly grow", "Without written limits a useful tool slowly gets new tasks, new data and new users, and the original assessment no longer fits. Treat every extension as a new assessment."],
    gv_lit: ["The people who use it are trained on what it can and cannot do", "The EU AI Act expects every business that uses AI to make sure its people understand it well enough (AI literacy, Art 4), whatever the risk class. This duty is not covered by the guide this tool follows."],
    gv_trig: ["You set a review date and the events that trigger a new assessment", ""],
  };
  for (const q of Q) {
    const p = PLAIN[q.id]; q.orig = q.text;
    if (p) { q.text = p[0]; q.info = p[1] || q.hint || ""; if (p[2]) q.short = p[2]; } else q.info = q.hint || "";
    q.hint = "";
  }

  // only legal references are shown to the visitor (an article or a regime), never the sources of this tool's own text
  const LEGAL = [
    [/^EU AI Act Art 5/, "EU AI Act Art 5"], [/^EU AI Act Art 4$/, "EU AI Act Art 4"], [/^EU AI Act Annex III/, "EU AI Act Annex III"], [/Art 2$/, "EU AI Act Art 2"],
    [/step 2; Part 3$/, "DORA"], [/Parts 3, 20, 26 \(Art 30\)/, "DORA Art 30"], [/Parts 3, 20, 26/, "DORA"], [/Part 26$/, "NIS2"],
    [/17\.4 \(Art 6\(1\)\)/, "EU AI Act Art 6(1)"], [/17\.4 \(Art 6\(3\)\)|^Guide 17\.4$/, "EU AI Act Art 6(3)"], [/17\.4 \(Art 50\)/, "EU AI Act Art 50"],
    [/17\.7\.3/, "EU AI Act, general-purpose models"], [/17\.7\.1 \((Arts? [\d, ]+)\)/, m => "EU AI Act " + m[1]], [/17\.7\.2/, "EU AI Act, high-risk provider obligations"],
    [/Part 2 \(Art 22\)|step 5 \(Art 22\)/, "GDPR Art 22"], [/Part 2 \(Chapter V\)/, "GDPR Chapter V"], [/Part 2 \(Art 28\)/, "GDPR Art 28"], [/\(Art 30\)/, "GDPR Art 30"], [/\(Art 33, 34\)/, "GDPR Arts 33 and 34"],
    [/Part 22/, "GDPR Art 35"], [/17\.11\.4/, "GDPR data-subject rights"], [/17\.11\.2|step 5; Part 2$/, "GDPR"], [/17\.6\.7/, "ISO/IEC 42005"],
  ];
  for (const q of Q) { const hit = LEGAL.find(([re]) => re.test(q.ref)); q.ref = hit ? (typeof hit[1] === "function" ? hit[1](hit[0].exec(q.ref)) : hit[1]) : ""; }
  const BY = {}; for (const q of Q) BY[q.id] = q;
  const TRIGGERS = ["A model or supplier change", "A change of purpose, data or volume", "A new country or user group", "An incident or complaint", "Drift beyond the agreed thresholds", "A change in law or guidance", "A fixed review date"];
  const SEV_W = { crit: 0, major: 1, minor: 2 }, SEV_T = { crit: "Critical", major: "Major", minor: "Minor" };

  // ---- evaluation ----------------------------------------------------------------------------------------------------------------
  function evaluate(a) {
    const f = (a && a.f) || {}, q = (a && a.q) || {};
    const v = id => (q[id] === "yes" || q[id] === "no" ? q[id] : "unk");
    const y = id => v(id) === "yes", u = id => v(id) === "unk";
    const c = { f, v, y, u, n: id => v(id) === "no" };
    const euOut = v("eu") === "no";
    // 1. classification (facts only)
    const hy = !euOut && HIGH.some(y);
    let tier, prov = false;
    if (euOut) tier = "out";
    else if (PROH.some(y)) tier = "prohibited";
    else if (hy) { if (y("d_prof")) tier = "high"; else if (y("d_narrow")) { tier = "derog"; prov = u("d_prof"); } else { tier = "high"; prov = u("d_narrow") || u("d_prof"); } }
    else if (PROH.some(u) || HIGH.some(u)) tier = "open";
    else if (TRANS.some(y)) tier = "limited";
    else if (TRANS.some(u)) tier = "open";
    else tier = "minimal";
    const openClass = [];
    if (!euOut) {
      for (const id of PROH) if (u(id) && tier !== "prohibited") openClass.push(id);
      if (!hy && tier !== "prohibited") for (const id of HIGH) if (u(id)) openClass.push(id);
      if (!hy && tier !== "prohibited") for (const id of TRANS) if (u(id)) openClass.push(id);
      if (tier === "high" || tier === "derog") for (const id of ["d_prof", "d_narrow"]) if (u(id)) openClass.push(id);
    }
    const build = f.build || "";
    c.hy = hy; c.tier = tier; c.tierHigh = hy || tier === "high"; c.transp = !euOut && TRANS.some(y);
    c.provider = ["build_api", "sell", "selfhost"].includes(build) || y("r_own") || y("r_subst") || y("r_purpose");
    c.deployer = !c.provider;
    c.dpiaTrig = ["dp_sp", "dp_prof", "dp_mon", "dp_dec", "dp_new"];
    // 2. depth
    const people = f.people || [], dk = f.data || [];
    const deep = ["prohibited", "high", "derog"].includes(tier) || y("dp_sp") || y("dp_auto") || y("dp_dec") || y("dp_prof") || (y("fin") && y("fin_imp")) || (f.autonomy === "acts" && people.some(p => p !== "none"));
    const light = !deep && ["minimal", "out"].includes(tier) && v("pd") === "no" && f.autonomy === "suggest" && !dk.includes("confidential") && !dk.includes("financial") && !y("sector") && !y("fin");
    const depth = deep ? 3 : light ? 1 : 2;
    // 3. what is asked
    const visible = {}, items = [];
    for (const k of Q) {
      const show = (k.when ? !!k.when(c) : true) && (k.kind === "fact" || k.lvl <= depth);
      visible[k.id] = show;
      if (show && k.kind === "ctl") {
        const r = v(k.id);
        items.push({ id: k.id, sec: k.sec, text: k.text, ref: k.ref, sev: k.sev, fix: k.fix, state: r === "yes" ? "ok" : r === "no" ? "gap" : "open" });
      }
    }
    const gaps = items.filter(i => i.state === "gap").sort((x, z) => SEV_W[x.sev] - SEV_W[z.sev]);
    const open = items.filter(i => i.state === "open").sort((x, z) => SEV_W[x.sev] - SEV_W[z.sev]);
    const critGap = gaps.filter(i => i.sev === "crit"), critOpen = open.filter(i => i.sev === "crit");
    const share = items.length ? open.length / items.length : 0;
    // 4. the outcome: no score, no averaging
    let code;
    if (tier === "prohibited") code = "stop";
    else if (critGap.length) code = "notready";
    else if (tier === "open" || openClass.length) code = "escalate";
    else if (critOpen.length || share >= 0.3 || (v("eu") === "unk") || (v("pd") === "unk")) code = "incomplete";
    else if (gaps.length || open.length || prov) code = "conditions";
    else code = "ready";
    // 5. roles and applicable regimes
    const roles = [];
    if (!euOut) {
      if (c.provider) roles.push("EU AI Act: provider. Building a system and putting it into service under your own name makes you its provider, even if only your own staff use it.");
      else roles.push("EU AI Act: deployer (you use someone else's system). You become a provider if you put your own name on it, change it substantially or change its purpose (Art 25).");
      if (y("g_model")) roles.push("EU AI Act: provider of a general-purpose AI model.");
      if (y("r_imp")) roles.push("EU AI Act: importer (Arts 23, 24).");
      if (y("r_dist")) roles.push("EU AI Act: distributor (Arts 23, 24).");
    }
    if (v("pd") !== "no") roles.push("Data protection: you are usually the controller of your own use; a supplier that processes data for you is usually a processor, to be confirmed in the contract" + (v("pd") === "unk" ? " (personal data is still an open question)." : "."));
    if (y("fin")) roles.push("DORA: you are a financial entity (or its ICT provider); the AI supplier is an ICT third-party service provider.");
    const regimes = [["EU AI Act", v("eu")], ["Personal data (GDPR and national laws)", v("pd")], ["DORA", v("fin")], ["NIS2", v("nis2")], ["Other sector rules", v("sector")], ["Contracts and policy", v("contract")], ["ISO management-system scope", v("mgmt")]]
      .map(([name, r]) => ({ name, state: r === "yes" ? "applies" : r === "no" ? "no" : "open" }));
    const dpia = v("pd") === "no" ? "no" : c.dpiaTrig.some(y) ? "needed" : c.dpiaTrig.some(u) ? "open" : "no";
    const why = [];
    why.push("Class under the EU AI Act: " + TIER_TEXT[tier].title + (prov ? " (provisional: the derogation or profiling question is still open)" : "") + ".");
    if (tier === "prohibited") why.push("You answered Yes to a prohibited practice: " + PROH.filter(y).map(id => BY[id].short || BY[id].text.replace(/\?$/, "")).join("; ") + ".");
    if (tier === "high") why.push("High-risk because of: " + (HIGH.filter(y).map(id => BY[id].short || BY[id].text.split(":")[0].replace(/\?$/, "")).join("; ")) + ".");
    if (critGap.length) why.push("A critical gap is not offset by good answers elsewhere: " + critGap.map(i => i.text).join("; ") + ".");
    if (critOpen.length && !critGap.length) why.push("A critical control is still unknown: " + critOpen.map(i => i.text).join("; ") + ".");
    if (share >= 0.3) why.push(Math.round(share * 100) + " % of the questions asked are still \"Not sure\", which is too much to judge on.");
    why.push("Assessment depth: " + DEPTH_TEXT[depth] + ".");
    return { code, tier, prov, depth, visible, items, gaps, open, critGap, critOpen, share, openClass, roles, regimes, dpia, why, transp: c.transp, provider: c.provider, hy,
      asked: items.length, ok: items.filter(i => i.state === "ok").length };
  }

  const TIER_TEXT = {
    out: { title: "Outside the EU AI Act, as answered", sub: "Check again if anything or anyone in the EU is reached." },
    prohibited: { title: "A possible PROHIBITED practice (Art 5)", sub: "Banned since 2 Feb 2025; fines up to EUR 35 million or 7 % of global turnover." },
    high: { title: "High-risk AI system", sub: "Provider: the ten obligations (Arts 9 to 17, 21 and 43). Deployer: the Art 26 duties." },
    derog: { title: "Annex III area, Art 6(3) derogation claimed", sub: "Not high-risk only if the derogation is documented before market placement and the system is registered; profiling natural persons is always high-risk." },
    limited: { title: "Transparency duties (Art 50)", sub: "People must know they deal with AI, and synthetic content must be marked." },
    minimal: { title: "Minimal risk", sub: "No mandatory AI Act obligations; data protection and the other regimes still apply." },
    open: { title: "NOT RESOLVED: classification is unclear", sub: "Unclear means escalate to legal or privacy; do not default to the lower class." },
  };
  const DEPTH_TEXT = { 1: "light (low risk, no personal data, no consequential decisions)", 2: "standard", 3: "full (adds the impact assessment, DPIA checks and the adversarial tests)" };
  const OUTCOME = {
    stop: { title: "Stop: a possible prohibited practice", cls: "bad", text: "Do not proceed. Escalate to legal now; a banned practice cannot be fixed with controls." },
    notready: { title: "Not ready: critical gaps", cls: "bad", text: "A critical weakness is not offset by good results elsewhere. Fix the critical gaps, then assess again." },
    escalate: { title: "Escalate: the classification is not settled", cls: "warn", text: "Answer the open classification questions, or give them to legal or privacy. Unclear is never a pass." },
    incomplete: { title: "Too much is unknown to approve", cls: "warn", text: "A reassuring result is withheld while the evidence is thin. Turn the \"Not sure\" answers into facts first." },
    conditions: { title: "Could be approved with conditions", cls: "warn", text: "Each condition below needs an owner and a date. The risk owner accepts the residual risk by name, with legal, privacy and security opinions on record." },
    ready: { title: "No gaps found on these answers", cls: "good", text: "Ready for the risk owner's decision. This is a prioritisation aid for people, not a certificate: keep the evidence, and re-assess on the triggers." },
  };
  const DISCLAIMER = "A decision aid, not a legal opinion. It follows a practitioner method for AI use-case assessments and the author's summaries of the rules, which may be incomplete, out of date or wrong for your case. Confirm legal conclusions against the current texts and with qualified counsel. Nothing is scored: an answer of \"Not sure\" is never counted as compliant.";
  const DATES = "Dates: the EU AI Act timetable many sources quote (high-risk obligations from 2 Aug 2026 and 2 Aug 2027) predates the Digital Omnibus, Reg (EU) 2026/1744 (in force 27 Jul 2026), which moved high-risk Annex III systems to 2 Dec 2027 and Annex I products to 2 Aug 2028. Check the current law before relying on a date.";

  // ---- report and summary --------------------------------------------------------------------------------------------------------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
  const label = (list, id) => { const x = list.find(e => e[0] === id); return x ? x[1] : ""; };
  function intakeRows(f) {
    return [["Use case", f.name], ["Reference", f.ref], ["Business owner", f.owner], ["Technical owner", f.techowner], ["Assessed by", f.assessor], ["Model or product and version", f.model], ["Where it runs", f.region], ["Purpose", f.purpose], ["Expected benefit", f.benefit], ["Process and decision it supports", f.process],
      ["Stage", label(STAGES, f.stage)], ["How it is built or bought", label(BUILDS, f.build)], ["Autonomy", label(AUTONOMY, f.autonomy)], ["Volume", label(SCALE, f.scale)],
      ["People affected", (f.people || []).map(p => label(PEOPLE, p)).join("; ")], ["Other data involved", (f.data || []).map(p => label(DATA, p)).join("; ")], ["Countries", f.countries]].filter(r => r[1]);
  }
  function summaryText(a, r) {
    const f = (a && a.f) || {}, o = OUTCOME[r.code], L = ["AI Use Case Intake & Assessment (Michel's Tools)", f.name ? "Use case: " + f.name + (f.ref ? " (" + f.ref + ")" : "") : "", "", o.title, o.text, "EU AI Act class: " + TIER_TEXT[r.tier].title, "Depth: " + DEPTH_TEXT[r.depth]].filter((x, i) => x !== "" || i === 2);
    L.push("", "Roles"); for (const x of r.roles) L.push("  - " + x);
    L.push("", "Regimes"); for (const x of r.regimes) L.push("  - " + x.name + ": " + (x.state === "applies" ? "applies" : x.state === "no" ? "does not apply (as answered)" : "to be confirmed"));
    if (r.gaps.length) { L.push("", "Gaps"); for (const i of r.gaps) L.push("  - [" + SEV_T[i.sev] + "] " + i.text + (i.fix ? " Fix: " + i.fix : "")); }
    if (r.open.length) { L.push("", "Still unknown (each is a finding)"); for (const i of r.open) L.push("  - [" + SEV_T[i.sev] + "] " + i.text); }
    L.push("", "Re-assess on: " + TRIGGERS.join("; ") + ".", "", DISCLAIMER);
    return L.join("\n");
  }
  function reportHtml(a, r, now) {
    const f = (a && a.f) || {}, o = OUTCOME[r.code], col = { bad: "#C23A14", warn: "#8A6D00", good: "#3F7A2E" }[o.cls];
    const tr = (cells, head) => "<tr>" + cells.map(x => "<" + (head ? "th" : "td") + ">" + esc(x) + "</" + (head ? "th" : "td") + ">").join("") + "</tr>";
    const list = (xs) => "<ul>" + xs.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";
    const rows = items => items.length ? "<table><thead>" + tr(["Severity", "What", "What to do", "Basis", "Owner", "Due"], true) + "</thead><tbody>" + items.map(i => tr([SEV_T[i.sev], i.text, i.fix, i.ref, "", ""])).join("") + "</tbody></table>" : "<p>None.</p>";
    const body = [
      "<h1>AI Use Case Intake &amp; Assessment</h1><p class=m>Michel's Tools &middot; " + esc(new Date(now == null ? Date.now() : now).toISOString().slice(0, 16).replace("T", " ")) + " UTC</p>",
      "<div class=v style=\"border-color:" + col + "\"><b>" + esc(o.title) + "</b><br>" + esc(o.text) + "</div>",
      "<h2>The use case</h2><table>" + intakeRows(f).map(x => tr(x)).join("") + "</table>",
      "<h2>Result</h2><table>" + tr(["EU AI Act class", TIER_TEXT[r.tier].title + (r.prov ? " (provisional)" : "")]) + tr(["Why", ""]) + "</table>" + list(r.why) + "<p>" + esc(TIER_TEXT[r.tier].sub) + "</p>",
      "<h2>Roles</h2>" + list(r.roles),
      "<h2>Which rules apply</h2><table>" + r.regimes.map(x => tr([x.name, x.state === "applies" ? "applies" : x.state === "no" ? "does not apply (as answered)" : "to be confirmed"])).join("") + "</table>",
      "<h2>Gaps</h2>" + rows(r.gaps), "<h2>Still unknown (each is a finding)</h2>" + rows(r.open),
      "<h2>Sign-off</h2><table>" + ["Risk owner (accepts the residual risk)", "Legal opinion", "Privacy opinion", "Security opinion"].map(x => tr([x, "Name:", "Date:"])).join("") + "</table>",
      "<h2>Re-assess on</h2>" + list(TRIGGERS), "<p class=m>" + esc(DATES) + "</p>", "<p class=m>" + esc(DISCLAIMER) + "</p>",
    ].join("\n");
    return "<!doctype html><html lang=en><head><meta charset=utf-8><title>AI Use Case Intake &amp; Assessment</title><style>body{font:14px/1.5 Segoe UI,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1B2740}h1{font-size:22px;color:#0B2F8A}h2{font-size:16px;color:#0B2F8A;border-bottom:1px solid #C9D3E6;padding-bottom:2px;margin-top:22px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #C9D3E6;padding:5px 8px;text-align:left;vertical-align:top}th{background:#EEF2F8}.m{color:#5A6B8C;font-size:12px}.v{border:2px solid;border-radius:8px;padding:10px 14px;margin:12px 0}</style></head><body>" + body + "</body></html>";
  }

  const api = { STAGES, BUILDS, AUTONOMY, SCALE, PEOPLE, DATA, SECTIONS, QUESTIONS: Q, BY, TIER_TEXT, OUTCOME, DEPTH_TEXT, DISCLAIMER, DATES, TRIGGERS, SEV_T, evaluate, summaryText, reportHtml, esc, PROH, HIGH, TRANS };
  if (typeof window !== "undefined") window.AIAssess = api;
  if (typeof module !== "undefined") module.exports = api;
})();
