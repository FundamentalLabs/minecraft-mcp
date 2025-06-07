import mineflayer_pathfinder from 'mineflayer-pathfinder';
const { goals } = mineflayer_pathfinder;
import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Block } from 'prismarine-block';

import { ISkillServiceParams, ISkillParams } from '../../types/skillType.js';
import { isSignalAborted, validateSkillParams } from '../index.js';
import { asyncwrap } from '../library/asyncwrap.js';
import { cancelableMove } from '../library/navigateToLocation.js';

const { GoalNear } = goals;

/**
 * Harvest mature crops around the bot.
 *
 * @param {Bot} bot - The Mineflayer bot instance.
 * @param {IFunctionCall} params - The parameters for the skill function.
 * @param {number} params.number - OPTIONAL: The number of wheat to harvest. Defaults to 1000.
 * @param {number} params.radius.radius - OPTIONAL: The radius around the your current position within which to harvest mature crops. Defaults to 16.
 * @param {ISkillServiceParams} serviceParams - additional parameters for the skill function.
 *
 * @return {Promise<boolean>} - Returns true if the bot successfully harvested mature crops, false otherwise.
 */
export const harvestMatureCrops = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams,
): Promise<boolean> => {
  const skillName = 'harvestMatureCrops';
  const requiredParams: string[] = [];
  const isParamsValid = validateSkillParams(
    params,
    requiredParams,
    skillName,
  );
  if (!isParamsValid) {
    serviceParams.cancelExecution?.();
    bot.emit(
      'alteraBotEndObservation',
      `Mistake: You didn't provide all of the required parameters ${requiredParams.join(', ')} for the ${skillName} skill.`,
    );
    return false;
  }

  const unpackedParams = {
    number: params.number ?? 1000,
    radius: params.radius ?? 16,
  };

  const { number, radius } = unpackedParams;
  const { signal, getStatsData, setStatsData } = serviceParams;

  // Define crop types and their mature stage block state
  const cropsInfo = [
    { name: 'wheat', matureState: 7 },
    { name: 'carrots', matureState: 7 },
    { name: 'potatoes', matureState: 7 },
    { name: 'beetroots', matureState: 3 }, // Note: Beetroots mature at state 3
  ];

  const matureCrops = await findMatureCrops(bot, { cropsInfo, number, radius });

  // console.log("Mature crops found: ", matureCrops.length)
  if (matureCrops.length === 0) {
    return bot.emit(
      'alteraBotEndObservation',
      'You tried to harvest crops but there are no mature crops found nearby.',
    );
  }

  await harvestCrops(bot, { matureCrops, signal, getStatsData, setStatsData });
  bot.emit('alteraBotEndObservation', 'You have finished harvesting crops');
};

interface IFindMatureCropsOptions {
  cropsInfo: { name: string; matureState: number }[];
  number: number;
  radius: number;
}
/**
 * Find mature crops around the bot.
 * @param {Bot} bot - The Mineflayer bot instance.
 * @param {IFindMatureCropsOptions} options - The options for finding mature crops.
 * @param {Array<{name:string, matureState:number}>} options.cropsInfo - The crop types and their mature stage block state.
 * @param {number} options.number - The number of mature crops to find.
 * @param {number} options.radius - The radius around the bot's current position within which to find mature crops.
 *
 * @return {Promise<Array<{x:number, y:number, z:number}>>} - Returns an array of positions of mature crops.
 */
const findMatureCrops = async (
  bot: Bot,
  options: IFindMatureCropsOptions,
): Promise<Array<{ x: number; y: number; z: number }>> => {
  const { cropsInfo, number, radius } = options;
  const matureCrops = [];
  for (const cropInfo of cropsInfo) {
    const cropBlockId = bot.registry.blocksByName[cropInfo.name]?.id;
    if (!cropBlockId) continue; // Skip if crop type is not found in registry

    const positions = bot.findBlocks({
      point: bot.entity.position,
      matching: (block) =>
        block.type === cropBlockId && block.metadata === cropInfo.matureState,
      maxDistance: radius,
      count: number,
    });

    matureCrops.push(...positions);
  }
  return matureCrops;
};

interface IHarvestCrops {
  matureCrops: Array<{ x: number; y: number; z: number }>;
  signal: AbortSignal;
  getStatsData: ISkillServiceParams['getStatsData'];
  setStatsData: ISkillServiceParams['setStatsData'];
}
/**
 * Harvest mature crops around the bot.
 * @param {Bot} bot - The Mineflayer bot instance.
 * @param {IHarvestCrops} options - The options for harvesting mature crops.
 * @param {Array<{x:number, y:number, z:number}>} options.matureCrops - The positions of mature crops to harvest.
 * @param {AbortSignal} options.signal - The signal to cancel the harvesting process.
 * @param {ISkillServiceParams['getStatsData']} options.getStatsData - The function to get stats data.
 * @param {ISkillServiceParams['setStatsData']} options.setStatsData - The function to set stats data.
 *
 * @return {Promise<boolean>} - Returns true if the bot successfully harvested mature crops, false otherwise.
 */
const harvestCrops = async (
  bot: Bot,
  options: IHarvestCrops,
): Promise<boolean> => {
  const { matureCrops, signal, getStatsData, setStatsData } = options;

  for (const pos of matureCrops) {
    try {
      const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
      if (block) {
        const goal = new GoalNear(pos.x, pos.y, pos.z, 1);
        const result = cancelableMove(bot, { goal, signal });
        // check for cancellation signal
        if (isSignalAborted(signal)) {
          return bot.emit(
            'alteraBotEndObservation',
            `You decided to do something else and stopped harvesting.`,
          );
        }

        const digFn = async function () {
          return bot.dig(block);
        };
        await asyncwrap({ func: digFn, getStatsData, setStatsData });

        bot.emit(
          'alteraBotTextObservation',
          `Harvested ${block.name} at (${pos.x}, ${pos.y}, ${pos.z})`,
        );

        // Wait for items to drop
        const waitFn = async function () {
          return new Promise((resolve) => setTimeout(resolve, 1000));
        };
        await asyncwrap({ func: waitFn, setStatsData, getStatsData }); // Wait for 1 second
      }
    } catch (error) {
      console.error(
        `Failed to harvest at (${pos.x}, ${pos.y}, ${pos.z}): ${error}`,
      );
      bot.emit(
        'alteraBotEndObservation',
        `Failed to harvest at (${pos.x}, ${pos.y}, ${pos.z}): ${error}`,
      );
    }
  }
};


