/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type {
  SavedObjectsBulkCreateObject,
  SavedObjectsFindResponse,
  SavedObjectsFindResult,
  ISavedObjectsRepository,
  SavedObjectsClientContract,
  Logger,
} from '@kbn/core/server';
import {
  PackagePolicy,
  DeletePackagePoliciesResponse,
  PackagePolicyInput,
} from '@kbn/fleet-plugin/common';
import { createCspRuleSearchFilterByPackagePolicy } from '../../common/utils/helpers';
import {
  CLOUDBEAT_VANILLA,
  CSP_RULE_SAVED_OBJECT_TYPE,
  CSP_RULE_TEMPLATE_SAVED_OBJECT_TYPE,
} from '../../common/constants';
import type { CspRule, CspRuleTemplate } from '../../common/schemas';
import type { BenchmarkId } from '../../common/types';

const getBenchmarkTypeFilter = (type: BenchmarkId): string =>
  `${CSP_RULE_TEMPLATE_SAVED_OBJECT_TYPE}.attributes.metadata.benchmark.id: "${type}"`;

const isEnabledBenchmarkInputType = (input: PackagePolicyInput) => !!input.type && input.enabled;

export const getBenchmarkInputType = (inputs: PackagePolicy['inputs']): BenchmarkId => {
  const enabledInputs = inputs.filter(isEnabledBenchmarkInputType);

  // Use the only enabled input
  if (enabledInputs.length === 1) {
    return getInputType(enabledInputs[0].type);
  }

  // Use the default benchmark id for multiple/none selected
  return getInputType(CLOUDBEAT_VANILLA);
};

/**
 * Callback to handle creation of PackagePolicies in Fleet
 */
export const onPackagePolicyPostCreateCallback = async (
  logger: Logger,
  packagePolicy: PackagePolicy,
  savedObjectsClient: SavedObjectsClientContract
): Promise<void> => {
  await UpdateCspRulesAccordingToCspRuleTemplates(packagePolicy, savedObjectsClient, logger);
};

export const OnPackagePolicyUpgradeCallback = async (
  logger: Logger,
  packagePolicy: PackagePolicy,
  savedObjectsClient: SavedObjectsClientContract
): Promise<void> => {
  // Need to be removed
  packagePolicy.id = `04f32290-b7cf-47ee-803a-8286565f2b4b`;
  // Create csp-rules from the generic asset

  await UpdateCspRulesAccordingToCspRuleTemplates(packagePolicy, savedObjectsClient, logger);
};

const UpdateCspRulesAccordingToCspRuleTemplates = async (
  packagePolicy: PackagePolicy,
  savedObjectsClient: SavedObjectsClientContract,
  logger: Logger
): Promise<void> => {
  const benchmarkType = getBenchmarkInputType(packagePolicy.inputs);

  const oldCspRules: SavedObjectsFindResponse<CspRule> = await savedObjectsClient.find({
    type: CSP_RULE_SAVED_OBJECT_TYPE,
    perPage: 10000,
    filter: createCspRuleSearchFilterByPackagePolicy({
      packagePolicyId: packagePolicy.id,
      policyId: packagePolicy.policy_id,
    }),
  });

  const oldCspRulesDictionary: Map<string, SavedObjectsFindResult<CspRule>> = new Map(
    oldCspRules.saved_objects.map((rule) => [rule.attributes.metadata.rego_rule_id, rule])
  );

  // Create csp-rules from the generic asset
  const ruleTemplates: SavedObjectsFindResponse<CspRuleTemplate> = await savedObjectsClient.find({
    type: CSP_RULE_TEMPLATE_SAVED_OBJECT_TYPE,
    perPage: 10000,
    filter: getBenchmarkTypeFilter(benchmarkType),
  });

  const cspRules = generateRulesFromTemplates(
    packagePolicy.id,
    packagePolicy.policy_id,
    ruleTemplates.saved_objects,
    oldCspRulesDictionary ?? new Map()
  );

  try {
    await savedObjectsClient.bulkCreate(cspRules);
    logger.info(`Generated CSP rules for package ${packagePolicy.policy_id}`);
    await Promise.all(
      oldCspRules.saved_objects.map((rule) =>
        savedObjectsClient.delete(CSP_RULE_SAVED_OBJECT_TYPE, rule.id)
      )
    );
  } catch (e) {
    logger.error('failed to generate rules out of template');
    logger.error(e);
  }
};

/**
 * Callback to handle deletion of PackagePolicies in Fleet
 */
export const removeCspRulesInstancesCallback = async (
  deletedPackagePolicy: DeletePackagePoliciesResponse[number],
  soClient: ISavedObjectsRepository,
  logger: Logger
): Promise<void> => {
  try {
    const { saved_objects: cspRules }: SavedObjectsFindResponse<CspRule> = await soClient.find({
      type: CSP_RULE_SAVED_OBJECT_TYPE,
      filter: createCspRuleSearchFilterByPackagePolicy({
        packagePolicyId: deletedPackagePolicy.id,
        policyId: deletedPackagePolicy.policy_id,
      }),
      perPage: 10000,
    });
    await Promise.all(cspRules.map((rule) => soClient.delete(CSP_RULE_SAVED_OBJECT_TYPE, rule.id)));
  } catch (e) {
    logger.error(`Failed to delete CSP rules after delete package ${deletedPackagePolicy.id}`);
    logger.error(e);
  }
};

export const isCspPackageInstalled = async (
  soClient: ISavedObjectsRepository,
  logger: Logger
): Promise<boolean> => {
  // TODO: check if CSP package installed via the Fleet API
  try {
    const { saved_objects: postDeleteRules }: SavedObjectsFindResponse<CspRule> =
      await soClient.find({
        type: CSP_RULE_SAVED_OBJECT_TYPE,
      });

    if (!postDeleteRules.length) {
      return true;
    }
    return false;
  } catch (e) {
    logger.error(e);
    return false;
  }
};

const generateRulesFromTemplates = (
  packagePolicyId: string,
  policyId: string,
  cspRuleTemplates: Array<SavedObjectsFindResult<CspRuleTemplate>>,
  oldCspRules: Map<string, SavedObjectsFindResult<CspRule>>
): Array<SavedObjectsBulkCreateObject<CspRule>> =>
  cspRuleTemplates.map((template) => {
    const cspRule = oldCspRules.get(template.attributes.metadata.rego_rule_id);
    const response = {
      type: CSP_RULE_SAVED_OBJECT_TYPE,
      attributes: {
        ...template.attributes,
        package_policy_id: packagePolicyId,
        policy_id: policyId,
        enabled: cspRule?.attributes.enabled ?? template.attributes.enabled,
      },
    };
    return response;
  });

const getInputType = (inputType: string): string => {
  // Get the last part of the input type, input type structure: cloudbeat/<benchmark_id>
  return inputType.split('/')[1];
};
