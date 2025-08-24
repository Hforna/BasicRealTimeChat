
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Configuration;
using StackExchange.Redis;

public class GroupHub : Hub
{
    private readonly IDatabase _redis;
    public const string GroupAvaliableKey = "group:avaliable";
    public const string GroupInfosKey = "group:infos";

    public GroupHub(IConfiguration configuration)
    {
        _redis = ConnectionMultiplexer.Connect(configuration.GetConnectionString("redis")).GetDatabase();
    }

    public string SetUserName(string userName)
    {
        this.Context.Items["user-name"] = userName;

        return userName;
    }

    public async Task<List<string>> GetAvaliableGroups()
    {
        var groupList = await _redis.ListRangeAsync(GroupAvaliableKey, 0, -1);
        var groupsName = groupList.Select(d => d.ToString()).ToList();

        return groupsName;
    }

    public async Task CreateGroup(string groupName)
    {
        var user = GetUserName();

        var groupAvaliables = await GetAvaliableGroups();

        if (groupAvaliables.Contains(groupName))
            throw new HubException("A group with this name already exists");

        var groupInfos = new GroupInfos(user, 1, 0);
        var serialize = JsonSerializer.Serialize(groupInfos);
        var groupInfosVal = new RedisValue(serialize);

        await _redis.HashSetAsync(GroupInfosKey, groupName, groupInfosVal);
        await _redis.ListRightPushAsync(GroupAvaliableKey, groupName);

        await this.Clients.All.SendAsync("GroupCreated", groupInfos);
    }

    public async Task<GroupInfos> GetGroupInfos(string groupName)
    {
        var groupAvaliables = await GetAvaliableGroups();

        if(!groupAvaliables.Contains(groupName))
            throw new HubException("Group not exists");

        var infos = await _redis.HashGetAsync(GroupInfosKey, groupName);

        return JsonSerializer.Deserialize<GroupInfos>(infos);
    }

    public async Task<List<Message>> GetAllGroupMessages(string groupName)
    {
        var user = GetUserName();

        var groupAvaliables = await GetAvaliableGroups();

        if (!groupAvaliables.Contains(groupName))
            throw new HubException("Group not exists");

        var inAnyGroup = this.Context.Items.TryGetValue("groups", out var groups);

        if (!inAnyGroup)
            throw new HubException("User is not in this group");

        var userGroups = JsonSerializer.Deserialize<List<string>>(groups.ToString());
        if (userGroups.Contains(groupName) == false)
            throw new HubException("User is not in this group");

        var messagesObj = await _redis.SortedSetRangeByRankAsync($"group:{groupName}:messages", 0, -1, Order.Ascending);

        var messages = messagesObj.Select(msg => JsonSerializer.Deserialize<Message>(msg.ToString()));

        return messages.OrderBy(d => d.SentAt).ToList();
    }

    public async Task JoinGroup(string group)
    {
        GetUserName();

        var groupsAvaliable = await GetAvaliableGroups();

        if (!groupsAvaliable.Contains(group))
            throw new HubException("Group not exists");

        var inAnyGroup = this.Context.Items.TryGetValue("groups", out var userGroupsObj);
        var userGroups = new List<string>() { group };

        if(inAnyGroup)
            userGroups.AddRange(JsonSerializer.Deserialize<List<string>>(userGroupsObj.ToString()));

        this.Context.Items["groups"] = JsonSerializer.Serialize(userGroups);

        var groupInfos = await GetGroupInfos(group);
        groupInfos.totalUsers++;
        await _redis.HashSetAsync(
            GroupInfosKey, 
            new HashEntry[] { new HashEntry(group, JsonSerializer.Serialize(groupInfos)) 
        });

        await this.Groups.AddToGroupAsync(this.Context.ConnectionId, group);
    }

    public async Task LeaveGroup(string groupName)
    {
        GetUserName();

        var avaliableGroups = await GetAvaliableGroups();

        if (!avaliableGroups.Any(d => d.Equals(groupName, StringComparison.OrdinalIgnoreCase)))
            throw new HubException("Group not exists");

        var groups = this.Context.Items.TryGetValue("groups", out var value);
        if (!groups)
            throw new HubException("User is not in this group");

        var deserializeGroups = JsonSerializer.Deserialize<List<string>>(value.ToString());
        if(deserializeGroups.Contains(groupName) == false)
            throw new HubException("User is not in this group");

        deserializeGroups.Remove(groupName);
        this.Context.Items["groups"] =  deserializeGroups;

        var groupInfos = await GetGroupInfos(groupName);
        groupInfos.totalUsers--;
        await _redis.HashSetAsync(
            GroupInfosKey,
            new HashEntry[] { new HashEntry(groupName, JsonSerializer.Serialize(groupInfos))
        });

        await this.Clients.Group(groupName).SendAsync("UserLeaved", groupInfos);
        await this.Groups.RemoveFromGroupAsync(this.Context.ConnectionId, groupName.ToString());
    }

    public async Task SendGroupMessage(string text, string groupName)
    {
        var userName = GetUserName();

        var groupsExists = this.Context.Items.TryGetValue("groups", out var groups);

        if (!groupsExists)
            throw new HubException("User cannot send a message to a group that they is not assigned");

        var deserialize = JsonSerializer.Deserialize<List<string>>(groups.ToString());

        if (!deserialize.Contains(groupName))
            throw new HubException("User cannot send a message to a group that they is not assigned");

        var message = new Message(text, DateTime.UtcNow, userName);

        var score = DateTime.UtcNow.ToOADate();
        var groupSetKey = $"group:{groupName}:messages";

        var messagesExists = await _redis.KeyExistsAsync(groupSetKey);

        var addMessage = await _redis.SortedSetAddAsync(
            groupSetKey,
            JsonSerializer.Serialize(message),
            score
        );

        if (!messagesExists)
            await _redis.KeyExpireAsync(groupSetKey, TimeSpan.FromDays(1));

        if (!addMessage)
            throw new HubException("Couldn't save message in database");

        await this.Clients.Group(groupName).SendAsync("ReceiveGroupMessage", message);
    }

    private string GetUserName()
    {
        var userNameExists = this.Context.Items.TryGetValue("user-name", out var userName);

        if (!userNameExists)
            throw new HubException("User must set a name before send some message");

        return userName.ToString();
    }
}

public sealed record GroupInfos
{
    public string owner { get; set; }
    public int totalUsers { get; set; }
    public int online { get; set; }

    public GroupInfos(string owner, int totalUsers, int online)
    {
        this.owner = owner;
        this.totalUsers = totalUsers;
        this.online = online;
    }
}

public sealed record Message(string text, DateTime SentAt, string UserName);