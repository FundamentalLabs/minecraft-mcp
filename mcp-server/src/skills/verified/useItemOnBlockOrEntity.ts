import {Bot} from 'mineflayer';

import {ISkillServiceParams, ISkillParams} from '../../types/skillType.js';
import {closest, distance} from 'fastest-levenshtein';
import minecraftData from 'minecraft-data';

import {validateSkillParams} from '../index.js';
import {findClosestItemName} from '../library/findClosestItemName.js';
import {navigateToLocation} from '../library/navigateToLocation.js';

/**
 * Use an equipped item on an entity.
 *
 * @param {Object} bot - The Mineflayer bot instance.
 * @param {Object} params
 * @param {string} params.item - The name of the item to use, this should be null if you just want to use or attack the entity or block without a particular item
 * @param {string} params.target - The target that the item will be used on
 * @param {number} params.count - OPTIONAL: The number of times to use the item, defaults to a single time, or 1
 * @param {object} serviceParams - additional parameters for the skill function.
 *
 **/

export const useItemOnBlockOrEntity = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams,
): Promise<boolean> => {
  const mcData = minecraftData(bot.version);
  const skillName = 'useItemOnBlockOrEntity';
  const requiredParams = ['item', 'target'];
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
    item: params.item,
    target: params.target,
    count: params.count ?? 1,
  };

  let itemName;
  if (!unpackedParams.item || unpackedParams.item === '') {
    itemName = 'hands';
  } else {
    // First check if the item is valid
    itemName = findClosestItemName(bot, {name: unpackedParams.item});
    if (!itemName) {
      // if the item is not in the list, return an error message
      return bot.emit(
        'alteraBotEndObservation',
        `Mistake: The item ${unpackedParams.item} does not exist in Minecraft, so you can't use it on ${unpackedParams.target}.`,
      );
    }

    // Equip the item
    const inventoryItem = bot.inventory.findInventoryItem(
      itemName as any,
      null,
      false,
    );
    if (!inventoryItem) {
      return bot.emit(
        'alteraBotEndObservation',
        `Mistake: You don't have any ${itemName} in your inventory to use on ${unpackedParams.target}.`,
      );
    } else {
      console.log(
        `Equipping ${inventoryItem.name} to use on ${unpackedParams.target}.`,
      );
      await bot.equip(inventoryItem, 'hand');
    }
  }

  // Then check if the target is an entity or a block
  let targetIsEntity = false;
  let targetIsBlock = false;

  // Special case for boat, if boat is a substring of the target, map the target to boat
  if (unpackedParams.target.includes('boat')) {
    unpackedParams.target = 'boat';
  }

  // find a matching entity entry in mcData based on the name
  const entityName = closest(
    unpackedParams.target.toLowerCase(),
    Object.keys(mcData.entitiesByName),
  );
  const distanceToEntity = distance(
    unpackedParams.target.toLowerCase(),
    entityName,
  );
  if (distanceToEntity < 4) {
    targetIsEntity = true;
    console.log(`targetIsEntity is true, found ${entityName}`);
  }

  const blockName = closest(
    unpackedParams.target.toLowerCase(),
    Object.keys(mcData.blocksByName),
  );
  const distanceToBlock = distance(
    unpackedParams.target.toLowerCase(),
    blockName,
  );
  if (distanceToBlock < 4) {
    targetIsBlock = true;
    console.log(`targetIsBlock is true, found ${blockName}`);
  }

  if (!targetIsEntity && !targetIsBlock) {
    return bot.emit(
      'alteraBotEndObservation',
      `Mistake: The target ${unpackedParams.target} does not exist in Minecraft. Do you mean ${entityName} or ${blockName}?`,
    );
  }

  if (targetIsEntity && targetIsBlock) {
    if (distanceToBlock < distanceToEntity) {
      targetIsEntity = false;
    } else {
      targetIsBlock = false;
    }
  }

  if (targetIsEntity) {
    return useItemOnEntity(bot, {
      itemName,
      entityName,
      count: unpackedParams.count,
    });
  } else {
    return useItemOnBlock(bot, {
      itemName,
      blockName,
      count: unpackedParams.count,
    });
  }
};

interface IUseItemOnEntityOptions {
  itemName: string;
  entityName: string;
  count?: number;
}

export const useItemOnEntity = async (
  bot: Bot,
  options: IUseItemOnEntityOptions,
): Promise<boolean> => {
  const defaultOptions = {
    count: 1,
  };
  const {itemName, entityName, count} = {...defaultOptions, ...options};

  const nearbyEntityList = Object.values(bot.entities).filter(
    (entity) =>
      entity.name === entityName &&
      bot.entity.position.distanceTo(entity.position) <= bot.nearbyEntityRadius,
  );

  let entityList = [];

  if (nearbyEntityList.length > 0) {
    // sort the list by distance
    nearbyEntityList.sort(
      (a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position),
    );
    entityList = nearbyEntityList.slice(0, count);
  } else {
    return bot.emit(
      'alteraBotEndObservation',
      `You couldn't find any ${entityName} nearby. `,
    );
  }

  console.log(
    `Found ${entityList.length} ${entityName} nearby to use ${itemName} on.`,
  );

  let successCount = 0;
  // use the item on the entity
  for (const activeEntity of entityList) {
    const heldItem = bot.inventory.slots[36];

    if (itemName !== 'hands' && (heldItem === null || heldItem === undefined)) {
      return bot.emit(
        'alteraBotEndObservation',
        `You lost or wore out the ${itemName}.`,
      );
    }

    if (!bot.entities[activeEntity.id]) {
      console.log(
        `UseItemOnEntity: The entity ${activeEntity.name} is no longer valid, skipping.`,
      );
      continue; // Skip if the entity is no longer valid
    }

    if (activeEntity.position.distanceTo(bot.entity.position) > 2) {
      console.log(`Navigating to ${activeEntity.name}.`);
      await navigateToLocation(bot, {
        x: activeEntity.position.x,
        y: activeEntity.position.y,
        z: activeEntity.position.z,
        range: 2,
      });
    }

    console.log(`looking at ${activeEntity.name}.`);
    bot.lookAt(activeEntity.position);

    console.log(`Using ${itemName} on ${activeEntity.name}.`);

    try {
      bot.useOn(activeEntity);

      bot.waitForTicks(5);

      // We don't really know what's the best way to check if the item was used on the entity
      successCount++;
      // Wait for a short period before moving to the next entity
    } catch (err) {
      const error = err as Error;
      console.error(
        `Error using ${itemName} on ${activeEntity.name}: ${error.message}`,
      );
    }
  }

  return bot.emit(
    'alteraBotEndObservation',
    `You have successfully finished using ${itemName} on ${entityName}.`,
  );
};

interface IUseItemOnBlockOptions {
  itemName: string;
  blockName: string;
  count?: number;
}

export const useItemOnBlock = async (
  bot: Bot,
  options: IUseItemOnBlockOptions,
): Promise<boolean> => {
  const mcData = minecraftData(bot.version);
  const defaultOptions = {
    count: 1,
  };
  const {itemName, blockName, count} = {...defaultOptions, ...options};
  const blockPositions = bot.findBlocks({
    matching: mcData.blocksByName[blockName].id,
    maxDistance: bot.nearbyBlockXZRange,
    count: count, // ignore count, find all blocks, filter later
  });

  if (blockPositions.length === 0) {
    return bot.emit(
      'alteraBotEndObservation',
      `You couldn't find any ${blockName} nearby.`,
    );
  }

  console.log(
    `Found ${blockPositions.length} ${blockName} nearby to use ${itemName} on.`,
  );

  let successCount = 0;
  // use the item on the block
  for (const blockPosition of blockPositions) {
    const heldItem = bot.inventory.slots[36];
    if (itemName !== 'hands' && (heldItem === null || heldItem === undefined)) {
      return bot.emit(
        'alteraBotEndObservation',
        `You lost or wore out the ${itemName}.`,
      );
    }
    const block = bot.blockAt(blockPosition);
    if (blockPosition.distanceTo(bot.entity.position) > 2) {
      console.log(`Navigating to ${block.name}.`);
      await navigateToLocation(bot, {
        x: block.position.x,
        y: block.position.y,
        z: block.position.z,
        range: 2,
      });
    }
    console.log(`looking at ${block.name} at ${block.position}.`);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    console.log(`Using ${itemName} on ${block.name}.`);

    try {
      bot._client.write('use_item', {hand: 0}); // 0 for main hand
      bot._client.write('block_place', {
        location: block.position,
        direction: 1, // 1 for the top face of the block
        hand: 0,
        cursorX: 0.5,
        cursorY: 0.5,
        cursorZ: 0.5,
        insideBlock: false,
      });

      await bot.waitForTicks(5);

      // We don't really know what's the best way to check if the item was used on the block
      successCount++;
      // Wait for a short period before moving to the next block
    } catch (err) {
      const error = err as Error;
      console.error(
        `Error using ${itemName} on ${block.name}: ${error.message}`,
      );
    }
  }

  return bot.emit(
    'alteraBotEndObservation',
    `You have successfully finished using ${itemName} on ${blockName}.`,
  );
};


