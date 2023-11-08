# Supranet Networking

## Connecting to the Supranet

When the DATEX JS library is initialized, an anonymous endpoint is automatically created.
To connect to the network, call:
```ts
await Datex.Supranet.connect()
```
Per default, the endpoint joins the Supranet by connecting to a unyt.org relay endpoint with a websocket connection.
You can always add custom connection channels and also connect over multiple channels like WebRTC at the same time.

## Temporary connections

You can also create a temporary connection with a new anonymous endpoint that is only valid for the current session.
```ts
await Datex.Supranet.connectTemporary()
```


## Creating custom DATEX channels with the ComInterface

[TODO]
