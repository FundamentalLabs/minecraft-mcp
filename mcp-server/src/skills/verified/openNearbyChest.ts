import {Bot} from 'mineflayer';

import {ISkillServiceParams, ISkillParams} from '../../types/skillType.js';
import {isSignalAborted, validateSkillParams} from '../index.js';
import {asyncwrap} from '../library/asyncwrap.js';
import {findAChest, findNearbyChests} from '../library/findAChest.js';
import {navigateToLocation} from '../library/navigateToLocation.js';
import {updateChestInterface} from '../library/updateChestInterface.js';

/**
 * Opens the closest nearby chest that is currently unopened and presents its inventory to the agent
 * It is recommended to wait until the chest opens and decide what to place in or take out then.
 *
 * @param {Bot} bot - The Mineflayer bot instance.
 * @param {ISkillParams} params - The parameters for the skill function.
 * @param {ISkillServiceParams} serviceParams - Additional parameters for the skill function.
 *
 * @return {Promise<boolean>} - Returns true if the bot successfully opened a nearby chest, false otherwise.
 */
export const openNearbyChest = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams,
): Promise<boolean> => {
  const skillName = 'openNearbyChest';
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
    setStatsData: serviceParams.setStatsData,
    getStatsData: serviceParams.getStatsData,
    signal: serviceParams.signal,
  };
  const {setStatsData, getStatsData, signal} = unpackedParams;
  const NEARBY_DISTANCE = bot.nearbyBlockXZRange;
  const chestPositions = findNearbyChests(bot, {
    searchRadius: NEARBY_DISTANCE,
    maxChests: 3,
  });

  if (chestPositions.length === 0) {
    return bot.emit(
      'alteraBotEndObservation',
      'You tried to open a nearby chest but no chests found nearby. If you were taking out items, no items were taken out.',
    );
  }

  const chestPosition = await findAChest(bot, {posToAvoid: null});
  if (chestPosition) {
    const navigateToLocationFunc = async function () {
      return navigateToLocation(bot, {
        x: chestPosition.x,
        y: chestPosition.y,
        z: chestPosition.z,
        range: 2,
      });
    };
    await asyncwrap({func: navigateToLocationFunc, setStatsData, getStatsData});

    // check for cancellation signal
    if (isSignalAborted(signal)) {
      return bot.emit(
        'alteraBotEndObservation',
        `You decided to do something else and stopped opening the chest.`,
      );
    }

    const chestBlock = bot.blockAt(chestPosition);
    bot.lookAt(chestPosition.offset(0.5, 0.5, 0.5));

    if (!chestBlock)
      return bot.emit(
        'alteraBotEndObservation',
        'The chest you were trying to open no longer exists!',
      );

    await updateChestInterface(bot, {
      chestPosition,
      getStatsData,
      setStatsData,
    });
    return bot.emit(
      'alteraBotEndObservation',
      `You have opened a chest at ${chestPosition}.`,
    );
  } else {
    return bot.emit(
      'alteraBotEndObservation',
      'You tried to open a nearby chest but there are no chests nearby. If you were taking out items, no items were taken out.',
    );
  }
};


