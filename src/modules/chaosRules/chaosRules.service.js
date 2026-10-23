import mongoose, { mongo, set } from "mongoose";
import ChaosRuleSet, {RULE_TYPE} from "../../models/ChaosRule.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import { invalidateChaosCache } from "../../services/runtimeCache.service.js";

//deleteRule - single rule
//activate deactivate single rule
//add or update rules -> individual rule

//what we want to have is 
//activate deactive all rules at once on the project level
//activate deavtivate all rules at once on the endpoint level
//cache the chaosRule to redis
// All chaos writes invalidate the same data-plane cache contract. MockServer
// rebuilds it from MongoDB with a version check, so stale rule arrays cannot
// overwrite a newer write or resurrect a deleted rule.
const synchronizeChaosCache = (projectId, endpointId) =>
    invalidateChaosCache(projectId, endpointId);

function assertValidRuleType(ruleType){
    if(!RULE_TYPE.includes(ruleType)){
        throw new ApiError(400,`Invalid ruletype : ${ruleType}`);
    }
}

function assertValidProbability(probability){
    if(probability === undefined) return;
    if(typeof probability !== "number" || probability < 0 || probability > 1){
        throw new ApiError(400, "probability must be a number between 0 and 1");
    }
}

const upsertRuleService = async({
    projectId,
    endpointId = null,
    ruleType,
    probability ,
    config ,
    isEnabled ,
}) => {
    const now = new Date();

    // normalize IDs to ObjectId so MongoDB filter matches correctly
    const normalizedProjectId = new mongoose.Types.ObjectId(projectId);
    const normalizedEndpointId = endpointId
        ? new mongoose.Types.ObjectId(endpointId)
        : null;

    const setFields = {
        "rules.$[r].updatedAt" : now,
    };
    
    if(probability !== undefined){
        setFields["rules.$[r].probability"] = probability;
    }

    if(config !== undefined){
        setFields["rules.$[r].config"] = config;
    }

    if(isEnabled !== undefined){
        setFields["rules.$[r].isEnabled"] = isEnabled;
    }

    // try updating existing rule in place first
    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId: normalizedProjectId, endpointId: normalizedEndpointId, 'rules.ruleType': ruleType},
        { $set: setFields },
        {
            arrayFilters: [{'r.ruleType': ruleType}], 
            new: true
        }
    ).lean();

    if(updated){
        await synchronizeChaosCache(projectId, endpointId);
        return updated;
    }

    // rule doesn't exist yet — push it, but guard against duplicate ruleType
    // $ne check prevents a race condition from inserting two rules of the same type
    const created = await ChaosRuleSet.findOneAndUpdate(
        {
            projectId: normalizedProjectId,
            endpointId: normalizedEndpointId,
            "rules.ruleType": { $ne: ruleType },  // ← guard against duplicates
        },
        {
            $setOnInsert: { projectId: normalizedProjectId, endpointId: normalizedEndpointId },
            $push: {
                rules: {
                    _id: new mongoose.Types.ObjectId(),
                    ruleType,
                    probability,
                    config,
                    isEnabled,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        },
        { upsert: true, new: true }
    ).lean();

    await synchronizeChaosCache(projectId, endpointId);
    console.log("saved to MongoDB and redis!");
    return created;
}

const createChaosService = async({
    projectId,
    endpointId = null,
    ruleType,
    probability = 1.0,
    config = {},
    isEnabled = true,
}) => {
    
    assertValidProbability(probability);
    assertValidRuleType(ruleType);

    const now = new Date();

    try{
        const updated = await ChaosRuleSet.findOneAndUpdate(
            {projectId, endpointId, "rules.ruleType" : {$ne : ruleType}},
            {
                $setOnInsert : {projectId, endpointId},
                $push : {
                    rules : {
                        _id : new mongoose.Types.ObjectId(),
                        ruleType,
                        probability,
                        config,
                        isEnabled,
                        createdAt : now,
                        updatedAt: now,
                    },
                },
            },
            {upsert : true, new : true}
        );

        await synchronizeChaosCache(projectId, endpointId);
        return updated;
    }catch(error){
        if(error.code == 11000){
            throw new ApiError(409, `Rule "${ruleType}" already exists in the scope`)
        }
        throw error;
    }
}

const updateChaosService = async({
    projectId,
    endpointId = null,
    ruleType,
    probability,
    config,
    isEnabled,
}) => {
    assertValidProbability(probability);
    assertValidRuleType(ruleType);

    const setFields = {"rules.$[r].updatedAt" : new Date()};
    if(probability !== undefined) setFields["rules.$[r].probability"] = probability;
    if(config !== undefined) setFields["rules.$[r].config"] = config;
    if(isEnabled !== undefined) setFields["rules.$[r].isEnabled"] = isEnabled;

    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, "rules.ruleType" : ruleType},
        {$set : setFields},
        {arrayFilters : [{"r.ruleType" : ruleType}], new : true}
    );

    if(!updated){
        throw new ApiError(404, `Rule "${ruleType}" not found in this scope`)
    }

    await synchronizeChaosCache(projectId, endpointId);
    return updated;
}

const setEnabled = async({
    projectId,
    endpointId = null,
    ruleType,
    isEnabled
}) => {
    assertValidRuleType(ruleType);

    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, "rules.ruleType" : ruleType},
        {$set : {"rules.$[r].isEnabled" : isEnabled, "rules.$[r].updatedAt" : new Date()}},
        {arrayFilters: [{"r.ruleType" : ruleType}] , new: true}
    ).lean();

    if(!updated){
        throw new ApiError(404, "ruletype not found in this scope");
    }

    await synchronizeChaosCache(projectId, endpointId);

    return updated;
}

const activateChaosService = async({
    projectId, 
    endpointId = null,
    ruleType
}) => {
    return setEnabled({projectId, endpointId, ruleType, isEnabled: true});
}

const deactivateChaosService = async({

    projectId, 
    endpointId = null,
    ruleType
}) => {
    return setEnabled({projectId, endpointId, ruleType, isEnabled: false});
}

const deleteChaosService = async({projectId, endpointId = null, ruleType}) => {
    assertValidRuleType(ruleType);

    const updated = await ChaosRuleSet.findOneAndUpdate(
        {projectId, endpointId, "rules.ruleType" : ruleType},
        {$pull : {rules : {ruleType}}},
        {new : true}
    ).lean();

    if(!updated){
        throw new ApiError(404, "ruletype not found in this scope");
    }

    if(updated.rules && updated.rules.length === 0){
        // no rules left — delete the whole RuleSet document.
        await ChaosRuleSet.deleteOne({_id : updated._id});
    }

    await synchronizeChaosCache(projectId, endpointId);

    return updated;
}

const getChaosRulesService = async ({ projectId, endpointId = null }) => {
    const normalizedProjectId = new mongoose.Types.ObjectId(projectId);
    const normalizedEndpointId = endpointId
        ? new mongoose.Types.ObjectId(endpointId)
        : null;

    const ruleSet = await ChaosRuleSet.findOne({
        projectId: normalizedProjectId,
        endpointId: normalizedEndpointId,
    }).lean();

    const rules = ruleSet?.rules ?? [];

    return rules;
};

/**
 * Fetch ALL rule sets for a project in a single query.
 * Returns an array of { endpointId, rules } — one entry per scope.
 * endpointId is null for project-level rules.
 * Dashboard reads MongoDB directly; the separate Redis runtime cache is owned
 * by MockServer and is never populated with dashboard-only response shapes.
 */
const getAllProjectChaosRulesService = async ({ projectId }) => {
    // Single Mongo query — fetches every scope for this project at once
    const ruleSets = await ChaosRuleSet.find({
        projectId: new mongoose.Types.ObjectId(projectId),
    }).lean();

    const result = ruleSets.map((rs) => ({
        endpointId: rs.endpointId ? String(rs.endpointId) : null,
        rules: rs.rules ?? [],
    }));

    return result;
};

export {
    upsertRuleService,
    createChaosService,
    updateChaosService,
    activateChaosService,
    deactivateChaosService,
    deleteChaosService,
    getChaosRulesService,
    getAllProjectChaosRulesService,
}

